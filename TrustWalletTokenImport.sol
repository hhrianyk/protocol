// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract TrustWalletTokenImport is AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    // Роли
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    
    // Структуры данных
    struct TokenInfo {
        address tokenAddress;     // Адрес токена (для ERC20)
        string trcAddress;        // Адрес токена TRC20 (если применимо)
        bool isImported;          // Статус импорта
        uint256 timestamp;        // Время импорта
        string name;              // Название токена
        string symbol;            // Символ токена
        uint8 decimals;           // Количество десятичных знаков
        string tokenType;         // Тип токена (ERC20, TRC20 и т.д.)
        uint256 timeout;          // Индивидуальный таймаут (если 0, используется значение по умолчанию)
        bool hasCustomMetadata;   // Флаг, указывающий на использование пользовательских метаданных
    }

    // Структура для авторизации изменений в структуре кошелька
    struct WalletModification {
        address userAddress;      // Адрес пользователя
        string action;            // Тип действия (например, "import", "metadata_change")
        string data;              // Данные, связанные с действием
        uint256 timestamp;        // Время подписи
        bool used;                // Флаг использования подписи
    }

    // Структура для хранения информации о предложении мультиподписи
    struct MultiSigProposal {
        uint256 id;
        address proposer;
        bytes data;
        uint256 approvalCount;
        uint256 timestamp;
        bool executed;
        mapping(address => bool) approvals;
    }

    // Маппинги
    mapping(address => mapping(string => TokenInfo)) public importedTokens; // user => tokenId => TokenInfo
    mapping(address => string[]) public userTokensList; // user => массив tokenId
    mapping(string => address) public priceFeeds; // токен => оракул цены
    mapping(bytes32 => WalletModification) public walletModifications; // хеш подписи => данные модификации
    
    // Мультиподпись
    address[] public signers;
    uint256 public requiredSignatures;
    uint256 public proposalCount;
    mapping(uint256 => MultiSigProposal) public proposals;

    // Timelock
    uint256 public timeLockPeriod = 2 days;
    mapping(bytes32 => uint256) public pendingChanges;

    // Настраиваемые параметры
    uint256 public defaultImportTimeout = 24 hours;
    mapping(string => uint256) public categoryTimeouts; // категория => таймаут
    
    // Константы
    string private constant PREFIX = "\x19Ethereum Signed Message:\n32";
    
    // События
    event TokenImported(address indexed user, string indexed tokenId, uint256 timestamp);
    event ImportRevoked(address indexed user, string indexed tokenId, uint256 timestamp);
    event BatchImport(address indexed user, uint256 count, uint256 timestamp);
    event ImportRenewal(address indexed user, string indexed tokenId, uint256 newTimestamp);
    event InvalidSignatureAttempt(address indexed user, string indexed tokenId, uint256 timestamp);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, bytes data);
    event ProposalApproved(uint256 indexed proposalId, address indexed approver);
    event ProposalExecuted(uint256 indexed proposalId);
    event TimeoutUpdated(string category, uint256 newTimeout);
    event TimeLockScheduled(bytes32 indexed operationId, uint256 executionTime);
    event TimeLockExecuted(bytes32 indexed operationId);
    event WalletModificationSigned(address indexed user, string action, bytes32 signatureHash);
    event MetadataUpdated(address indexed user, string indexed tokenId, string name, string symbol, uint8 decimals);

    // Интеграция с DEX
    IUniswapV2Router02 public uniswapRouter;
    
    // TRC20 константы для USDT
    string public constant USDT_TRC20_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    string public constant USDT_NAME = "Tether";
    string public constant USDT_SYMBOL = "USDT";
    uint8 public constant USDT_DECIMALS = 0;

    constructor(address[] memory _signers, uint256 _requiredSignatures, address _uniswapRouter) {
        require(_signers.length >= _requiredSignatures, "Invalid signers/threshold");
        require(_requiredSignatures > 0, "Required signatures must be > 0");
        
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        
        signers = _signers;
        requiredSignatures = _requiredSignatures;
        
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
    }

    // =================== Модификаторы ===================
    
    modifier onlyMultiSig() {
        require(msg.sender == address(this), "Only via multisig");
        _;
    }
    
    modifier timelockRequired(bytes32 operationId) {
        if (pendingChanges[operationId] == 0) {
            pendingChanges[operationId] = block.timestamp + timeLockPeriod;
            emit TimeLockScheduled(operationId, pendingChanges[operationId]);
            return;
        }
        
        require(block.timestamp >= pendingChanges[operationId], "Timelock period not passed");
        delete pendingChanges[operationId];
        emit TimeLockExecuted(operationId);
        _;
    }

    // =================== Основная функциональность ===================

    /**
     * @dev Функция для импорта токена с подписью
     * @param tokenId уникальный идентификатор токена (адрес для ERC20, адрес+сеть для других)
     * @param signature подпись клиента
     */
    function importToken(string memory tokenId, bytes memory signature) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(bytes(tokenId).length > 0, "Invalid token ID");
        require(!importedTokens[msg.sender][tokenId].isImported, "Token already imported");

        // Создаем хеш сообщения
        bytes32 messageHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenId,
            block.timestamp
        ));

        // Проверяем подпись
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked(PREFIX, messageHash));
        address signer = ethSignedMessageHash.recover(signature);
        
        if (signer != msg.sender) {
            emit InvalidSignatureAttempt(msg.sender, tokenId, block.timestamp);
            revert("Invalid signature");
        }

        // Регистрируем подписанную модификацию кошелька
        bytes32 signatureHash = keccak256(abi.encodePacked(signature));
        walletModifications[signatureHash] = WalletModification({
            userAddress: msg.sender,
            action: "import",
            data: tokenId,
            timestamp: block.timestamp,
            used: true
        });
        
        emit WalletModificationSigned(msg.sender, "import", signatureHash);

        // Для TRC20 USDT используем предопределенные значения
        if (keccak256(abi.encodePacked(tokenId)) == keccak256(abi.encodePacked(USDT_TRC20_ADDRESS))) {
            importedTokens[msg.sender][tokenId] = TokenInfo({
                tokenAddress: address(0), // Не применимо для TRC20
                trcAddress: USDT_TRC20_ADDRESS,
                isImported: true,
                timestamp: block.timestamp,
                name: USDT_NAME,
                symbol: USDT_SYMBOL,
                decimals: USDT_DECIMALS,
                tokenType: "TRC20",
                timeout: 0, // Используем значение по умолчанию
                hasCustomMetadata: false
            });
            
            userTokensList[msg.sender].push(tokenId);
            emit TokenImported(msg.sender, tokenId, block.timestamp);
            return;
        }

        // Для ERC20 проверяем контракт
        address tokenAddress = parseAddressFromTokenId(tokenId);
        require(isContract(tokenAddress), "Address is not a contract");
        
        try IERC20(tokenAddress).totalSupply() returns (uint256) {
            string memory name = "Unknown";
            string memory symbol = "UNK";
            uint8 decimals = 18;
            
            // Попытка получить метаданные токена
            try ERC20Metadata(tokenAddress).name() returns (string memory _name) {
                name = _name;
            } catch {}
            
            try ERC20Metadata(tokenAddress).symbol() returns (string memory _symbol) {
                symbol = _symbol;
            } catch {}
            
            try ERC20Metadata(tokenAddress).decimals() returns (uint8 _decimals) {
                decimals = _decimals;
            } catch {}
            
            importedTokens[msg.sender][tokenId] = TokenInfo({
                tokenAddress: tokenAddress,
                trcAddress: "",
                isImported: true,
                timestamp: block.timestamp,
                name: name,
                symbol: symbol,
                decimals: decimals,
                tokenType: "ERC20",
                timeout: 0,
                hasCustomMetadata: false
            });
            
            userTokensList[msg.sender].push(tokenId);
            emit TokenImported(msg.sender, tokenId, block.timestamp);
        } catch {
            revert("Invalid ERC20 token");
        }
    }

    /**
     * @dev Функция для импорта токена с пользовательскими метаданными
     * @param tokenId уникальный идентификатор токена
     * @param signature подпись клиента
     * @param customName пользовательское имя токена
     * @param customSymbol пользовательский символ токена
     * @param customDecimals пользовательское количество десятичных знаков
     */
    function importTokenWithCustomMetadata(
        string memory tokenId, 
        bytes memory signature, 
        string memory customName, 
        string memory customSymbol, 
        uint8 customDecimals
    ) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(bytes(tokenId).length > 0, "Invalid token ID");
        require(!importedTokens[msg.sender][tokenId].isImported, "Token already imported");
        require(bytes(customName).length > 0, "Custom name required");
        require(bytes(customSymbol).length > 0, "Custom symbol required");

        // Создаем хеш сообщения с дополнительными данными о метаданных
        bytes32 messageHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenId,
            "metadata_change",
            customName,
            customSymbol,
            customDecimals,
            block.timestamp
        ));

        // Проверяем подпись
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked(PREFIX, messageHash));
        address signer = ethSignedMessageHash.recover(signature);
        
        if (signer != msg.sender) {
            emit InvalidSignatureAttempt(msg.sender, tokenId, block.timestamp);
            revert("Invalid signature");
        }

        // Регистрируем подписанную модификацию кошелька
        bytes32 signatureHash = keccak256(abi.encodePacked(signature));
        walletModifications[signatureHash] = WalletModification({
            userAddress: msg.sender,
            action: "metadata_change",
            data: tokenId,
            timestamp: block.timestamp,
            used: true
        });
        
        emit WalletModificationSigned(msg.sender, "metadata_change", signatureHash);

        address tokenAddress = parseAddressFromTokenId(tokenId);
        string memory tokenType = "ERC20";
        
        // Если это TRC20 адрес
        if (keccak256(abi.encodePacked(tokenId)) == keccak256(abi.encodePacked(USDT_TRC20_ADDRESS))) {
            tokenAddress = address(0);
            tokenType = "TRC20";
        } else if (tokenAddress != address(0)) {
            require(isContract(tokenAddress), "Address is not a contract");
            
            // Проверяем, что это токен ERC20
            try IERC20(tokenAddress).totalSupply() returns (uint256) {
                // Токен валиден
            } catch {
                revert("Invalid ERC20 token");
            }
        } else {
            // Для других типов токенов можно добавить другую логику
            tokenType = "OTHER";
        }
        
        // Создаем запись с пользовательскими метаданными
        importedTokens[msg.sender][tokenId] = TokenInfo({
            tokenAddress: tokenAddress,
            trcAddress: tokenType == "TRC20" ? tokenId : "",
            isImported: true,
            timestamp: block.timestamp,
            name: customName,
            symbol: customSymbol,
            decimals: customDecimals,
            tokenType: tokenType,
            timeout: 0,
            hasCustomMetadata: true
        });
        
        userTokensList[msg.sender].push(tokenId);
        
        emit TokenImported(msg.sender, tokenId, block.timestamp);
        emit MetadataUpdated(msg.sender, tokenId, customName, customSymbol, customDecimals);
    }

    /**
     * @dev Функция для обновления метаданных уже импортированного токена
     * @param tokenId идентификатор токена для обновления
     * @param signature подпись пользователя
     * @param newName новое имя токена
     * @param newSymbol новый символ токена
     * @param newDecimals новое количество десятичных знаков
     */
    function updateTokenMetadata(
        string memory tokenId,
        bytes memory signature,
        string memory newName,
        string memory newSymbol,
        uint8 newDecimals
    )
        external
        nonReentrant
        whenNotPaused
    {
        require(importedTokens[msg.sender][tokenId].isImported, "Token not imported");
        require(bytes(newName).length > 0, "New name required");
        require(bytes(newSymbol).length > 0, "New symbol required");

        // Создаем хеш сообщения
        bytes32 messageHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenId,
            "update_metadata",
            newName,
            newSymbol,
            newDecimals,
            block.timestamp
        ));

        // Проверяем подпись
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked(PREFIX, messageHash));
        address signer = ethSignedMessageHash.recover(signature);
        
        if (signer != msg.sender) {
            emit InvalidSignatureAttempt(msg.sender, tokenId, block.timestamp);
            revert("Invalid signature");
        }

        // Регистрируем подписанную модификацию кошелька
        bytes32 signatureHash = keccak256(abi.encodePacked(signature));
        walletModifications[signatureHash] = WalletModification({
            userAddress: msg.sender,
            action: "update_metadata",
            data: tokenId,
            timestamp: block.timestamp,
            used: true
        });
        
        emit WalletModificationSigned(msg.sender, "update_metadata", signatureHash);

        // Обновляем метаданные
        TokenInfo storage tokenInfo = importedTokens[msg.sender][tokenId];
        tokenInfo.name = newName;
        tokenInfo.symbol = newSymbol;
        tokenInfo.decimals = newDecimals;
        tokenInfo.hasCustomMetadata = true;
        
        emit MetadataUpdated(msg.sender, tokenId, newName, newSymbol, newDecimals);
    }

    /**
     * @dev Пакетный импорт нескольких токенов
     * @param tokenIds массив идентификаторов токенов
     * @param signatures массив подписей
     */
    function batchImportTokens(string[] memory tokenIds, bytes[] memory signatures) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(tokenIds.length == signatures.length, "Arrays length mismatch");
        require(tokenIds.length > 0, "Empty arrays");
        
        uint256 successCount = 0;
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            // Пропускаем уже импортированные токены
            if (importedTokens[msg.sender][tokenIds[i]].isImported) {
                continue;
            }
            
            bytes32 messageHash = keccak256(abi.encodePacked(
                msg.sender,
                tokenIds[i],
                block.timestamp
            ));
            
            bytes32 ethSignedMessageHash = keccak256(abi.encodePacked(PREFIX, messageHash));
            address signer = ethSignedMessageHash.recover(signatures[i]);
            
            if (signer != msg.sender) {
                emit InvalidSignatureAttempt(msg.sender, tokenIds[i], block.timestamp);
                continue;
            }
            
            // Регистрируем подписанную модификацию кошелька
            bytes32 signatureHash = keccak256(abi.encodePacked(signatures[i]));
            walletModifications[signatureHash] = WalletModification({
                userAddress: msg.sender,
                action: "batch_import",
                data: tokenIds[i],
                timestamp: block.timestamp,
                used: true
            });
            
            emit WalletModificationSigned(msg.sender, "batch_import", signatureHash);
            
            // Для TRC20 USDT
            if (keccak256(abi.encodePacked(tokenIds[i])) == keccak256(abi.encodePacked(USDT_TRC20_ADDRESS))) {
                importedTokens[msg.sender][tokenIds[i]] = TokenInfo({
                    tokenAddress: address(0),
                    trcAddress: USDT_TRC20_ADDRESS,
                    isImported: true,
                    timestamp: block.timestamp,
                    name: USDT_NAME,
                    symbol: USDT_SYMBOL,
                    decimals: USDT_DECIMALS,
                    tokenType: "TRC20",
                    timeout: 0,
                    hasCustomMetadata: false
                });
                
                userTokensList[msg.sender].push(tokenIds[i]);
                emit TokenImported(msg.sender, tokenIds[i], block.timestamp);
                successCount++;
                continue;
            }
            
            // Для ERC20
            address tokenAddress = parseAddressFromTokenId(tokenIds[i]);
            if (!isContract(tokenAddress)) {
                continue;
            }
            
            try IERC20(tokenAddress).totalSupply() returns (uint256) {
                string memory name = "Unknown";
                string memory symbol = "UNK";
                uint8 decimals = 18;
                
                try ERC20Metadata(tokenAddress).name() returns (string memory _name) {
                    name = _name;
                } catch {}
                
                try ERC20Metadata(tokenAddress).symbol() returns (string memory _symbol) {
                    symbol = _symbol;
                } catch {}
                
                try ERC20Metadata(tokenAddress).decimals() returns (uint8 _decimals) {
                    decimals = _decimals;
                } catch {}
                
                importedTokens[msg.sender][tokenIds[i]] = TokenInfo({
                    tokenAddress: tokenAddress,
                    trcAddress: "",
                    isImported: true,
                    timestamp: block.timestamp,
                    name: name,
                    symbol: symbol,
                    decimals: decimals,
                    tokenType: "ERC20",
                    timeout: 0,
                    hasCustomMetadata: false
                });
                
                userTokensList[msg.sender].push(tokenIds[i]);
                emit TokenImported(msg.sender, tokenIds[i], block.timestamp);
                successCount++;
            } catch {}
        }
        
        require(successCount > 0, "No tokens imported");
        emit BatchImport(msg.sender, successCount, block.timestamp);
    }

    /**
     * @dev Отзыв импорта токена
     * @param tokenId идентификатор токена для отзыва
     */
    function revokeImport(string memory tokenId) external nonReentrant {
        require(importedTokens[msg.sender][tokenId].isImported, "Token not imported");
        
        // Удаляем токен из списка
        for (uint256 i = 0; i < userTokensList[msg.sender].length; i++) {
            if (keccak256(abi.encodePacked(userTokensList[msg.sender][i])) == 
                keccak256(abi.encodePacked(tokenId))) {
                
                // Заменяем удаляемый элемент последним и уменьшаем длину массива
                userTokensList[msg.sender][i] = userTokensList[msg.sender][userTokensList[msg.sender].length - 1];
                userTokensList[msg.sender].pop();
                break;
            }
        }
        
        delete importedTokens[msg.sender][tokenId];
        
        emit ImportRevoked(msg.sender, tokenId, block.timestamp);
    }

    /**
     * @dev Продление срока действия импорта
     * @param tokenId идентификатор токена для продления
     */
    function renewImport(string memory tokenId) external nonReentrant whenNotPaused {
        require(importedTokens[msg.sender][tokenId].isImported, "Token not imported");
        
        importedTokens[msg.sender][tokenId].timestamp = block.timestamp;
        
        emit ImportRenewal(msg.sender, tokenId, block.timestamp);
    }

    /**
     * @dev Автоматическое продление всех импортов
     */
    function renewAllImports() external nonReentrant whenNotPaused {
        string[] memory userTokens = userTokensList[msg.sender];
        
        for (uint256 i = 0; i < userTokens.length; i++) {
            if (importedTokens[msg.sender][userTokens[i]].isImported) {
                importedTokens[msg.sender][userTokens[i]].timestamp = block.timestamp;
                emit ImportRenewal(msg.sender, userTokens[i], block.timestamp);
            }
        }
    }

    /**
     * @dev Проверка валидности импорта токена
     * @param user адрес пользователя
     * @param tokenId идентификатор токена
     */
    function isValidImport(address user, string memory tokenId) public view returns (bool) {
        TokenInfo memory tokenInfo = importedTokens[user][tokenId];
        
        if (!tokenInfo.isImported) {
            return false;
        }

        uint256 timeout = tokenInfo.timeout > 0 
            ? tokenInfo.timeout 
            : categoryTimeouts[tokenInfo.tokenType] > 0 
                ? categoryTimeouts[tokenInfo.tokenType] 
                : defaultImportTimeout;

        return (block.timestamp - tokenInfo.timestamp) <= timeout;
    }

    /**
     * @dev Получение списка всех импортированных токенов пользователя
     * @param user адрес пользователя
     */
    function getUserTokens(address user) external view returns (string[] memory) {
        return userTokensList[user];
    }

    /**
     * @dev Получение информации об импортированном токене
     * @param user адрес пользователя
     * @param tokenId идентификатор токена
     */
    function getTokenInfo(address user, string memory tokenId) 
        external 
        view 
        returns (
            address tokenAddress,
            string memory trcAddress,
            bool isImported,
            uint256 timestamp,
            string memory name,
            string memory symbol,
            uint8 decimals,
            string memory tokenType,
            uint256 timeout,
            bool hasCustomMetadata
        ) 
    {
        TokenInfo memory info = importedTokens[user][tokenId];
        return (
            info.tokenAddress,
            info.trcAddress,
            info.isImported,
            info.timestamp,
            info.name,
            info.symbol,
            info.decimals,
            info.tokenType,
            info.timeout > 0 ? info.timeout : categoryTimeouts[info.tokenType] > 0 
                ? categoryTimeouts[info.tokenType] : defaultImportTimeout,
            info.hasCustomMetadata
        );
    }

    /**
     * @dev Функция для получения хеша сообщения для подписания
     * @param tokenId идентификатор токена
     */
    function getMessageHash(string memory tokenId) external view returns (bytes32) {
        return keccak256(abi.encodePacked(
            msg.sender,
            tokenId,
            block.timestamp
        ));
    }

    /**
     * @dev Функция для получения хеша сообщения для подписания с метаданными
     * @param tokenId идентификатор токена
     * @param name имя токена
     * @param symbol символ токена
     * @param decimals десятичные знаки
     */
    function getMessageHashWithMetadata(
        string memory tokenId,
        string memory name,
        string memory symbol,
        uint8 decimals
    ) external view returns (bytes32) {
        return keccak256(abi.encodePacked(
            msg.sender,
            tokenId,
            "metadata_change",
            name,
            symbol,
            decimals,
            block.timestamp
        ));
    }

    /**
     * @dev Проверка подписи для действия с кошельком
     * @param user адрес пользователя
     * @param action тип действия
     * @param data данные действия
     * @param signature подпись
     */
    function verifyWalletModification(
        address user,
        string memory action,
        string memory data,
        bytes memory signature
    ) external view returns (bool) {
        bytes32 messageHash;
        
        if (keccak256(abi.encodePacked(action)) == keccak256(abi.encodePacked("import"))) {
            messageHash = keccak256(abi.encodePacked(
                user,
                data,
                block.timestamp
            ));
        } else {
            return false;
        }
        
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked(PREFIX, messageHash));
        address signer = ethSignedMessageHash.recover(signature);
        
        return signer == user;
    }

    // =================== DEX Интеграция ===================

    /**
     * @dev Получение цены токена через Chainlink оракулы
     * @param tokenSymbol символ токена
     */
    function getTokenPrice(string memory tokenSymbol) external view returns (int256, uint8) {
        address feedAddress = priceFeeds[tokenSymbol];
        require(feedAddress != address(0), "Price feed not available");
        
        AggregatorV3Interface priceFeed = AggregatorV3Interface(feedAddress);
        (
            /* uint80 roundID */,
            int256 price,
            /* uint startedAt */,
            /* uint timeStamp */,
            /* uint80 answeredInRound */
        ) = priceFeed.latestRoundData();
        
        return (price, priceFeed.decimals());
    }
    
    /**
     * @dev Добавление оракула цены токена
     * @param tokenSymbol символ токена
     * @param priceFeed адрес оракула
     */
    function setPriceFeed(string memory tokenSymbol, address priceFeed) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        require(priceFeed != address(0), "Invalid price feed");
        priceFeeds[tokenSymbol] = priceFeed;
    }
    
    /**
     * @dev Обмен токена через Uniswap
     * @param tokenAddress адрес токена для обмена
     * @param amountIn количество токенов для обмена
     * @param amountOutMin минимальное количество токенов для получения
     * @param path путь обмена
     * @param deadline срок действия транзакции
     */
    function swapExactTokensForTokens(
        address tokenAddress,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint[] memory amounts) {
        require(tokenAddress != address(0), "Invalid token address");
        
        IERC20 token = IERC20(tokenAddress);
        require(token.transferFrom(msg.sender, address(this), amountIn), "Transfer failed");
        require(token.approve(address(uniswapRouter), amountIn), "Approval failed");
        
        amounts = uniswapRouter.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            msg.sender,
            deadline
        );
        
        return amounts;
    }

    // =================== Мультиподпись ===================

    /**
     * @dev Создание предложения для мультиподписи
     * @param data данные для вызова
     */
    function proposeMultiSig(bytes memory data) external returns (uint256) {
        bool isSigner = false;
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == msg.sender) {
                isSigner = true;
                break;
            }
        }
        require(isSigner, "Not a signer");
        
        uint256 proposalId = proposalCount++;
        
        MultiSigProposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.data = data;
        proposal.timestamp = block.timestamp;
        proposal.approvals[msg.sender] = true;
        proposal.approvalCount = 1;
        
        emit ProposalCreated(proposalId, msg.sender, data);
        
        return proposalId;
    }
    
    /**
     * @dev Подтверждение предложения для мультиподписи
     * @param proposalId идентификатор предложения
     */
    function approveMultiSig(uint256 proposalId) external {
        MultiSigProposal storage proposal = proposals[proposalId];
        
        require(proposal.timestamp > 0, "Proposal does not exist");
        require(!proposal.executed, "Proposal already executed");
        require(!proposal.approvals[msg.sender], "Already approved");
        
        bool isSigner = false;
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == msg.sender) {
                isSigner = true;
                break;
            }
        }
        require(isSigner, "Not a signer");
        
        proposal.approvals[msg.sender] = true;
        proposal.approvalCount++;
        
        emit ProposalApproved(proposalId, msg.sender);
        
        if (proposal.approvalCount >= requiredSignatures) {
            _executeProposal(proposalId);
        }
    }
    
    /**
     * @dev Выполнение предложения для мультиподписи
     * @param proposalId идентификатор предложения
     */
    function _executeProposal(uint256 proposalId) internal {
        MultiSigProposal storage proposal = proposals[proposalId];
        
        require(!proposal.executed, "Proposal already executed");
        require(proposal.approvalCount >= requiredSignatures, "Not enough approvals");
        
        proposal.executed = true;
        
        (bool success, ) = address(this).call(proposal.data);
        require(success, "Execution failed");
        
        emit ProposalExecuted(proposalId);
    }

    // =================== Управление контрактом ===================

    /**
     * @dev Установка таймаута по умолчанию
     * @param newTimeout новое значение таймаута
     */
    function setDefaultTimeout(uint256 newTimeout) external onlyMultiSig {
        require(newTimeout > 0, "Timeout must be > 0");
        defaultImportTimeout = newTimeout;
        emit TimeoutUpdated("default", newTimeout);
    }
    
    /**
     * @dev Установка таймаута для категории токенов
     * @param category категория токенов
     * @param timeout значение таймаута
     */
    function setCategoryTimeout(string memory category, uint256 timeout) external onlyMultiSig {
        require(timeout > 0, "Timeout must be > 0");
        categoryTimeouts[category] = timeout;
        emit TimeoutUpdated(category, timeout);
    }
    
    /**
     * @dev Установка периода временной блокировки
     * @param newPeriod новое значение периода
     */
    function setTimeLockPeriod(uint256 newPeriod) external onlyMultiSig {
        require(newPeriod > 0, "Period must be > 0");
        timeLockPeriod = newPeriod;
    }
    
    /**
     * @dev Установка адреса Uniswap роутера
     * @param newRouter новый адрес роутера
     */
    function setUniswapRouter(address newRouter) external onlyMultiSig {
        require(newRouter != address(0), "Invalid router address");
        uniswapRouter = IUniswapV2Router02(newRouter);
    }
    
    /**
     * @dev Приостановка контракта
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Возобновление контракта
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @dev Внесение критического изменения с временной блокировкой
     * @param functionSignature хеш функции
     * @param data данные для вызова
     */
    function scheduleChange(bytes4 functionSignature, bytes memory data) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        bytes32 operationId = keccak256(abi.encodePacked(functionSignature, data));
        
        // Этот вызов только зарегистрирует изменение и выйдет из функции
        executeTimeLocked(operationId);
    }
    
    /**
     * @dev Выполнение запланированного изменения
     * @param operationId идентификатор операции
     */
    function executeTimeLocked(bytes32 operationId) 
        public 
        onlyRole(ADMIN_ROLE) 
        timelockRequired(operationId) 
    {
        // Выполняется только после истечения периода блокировки
    }

    // =================== Вспомогательные функции ===================

    /**
     * @dev Вспомогательная функция для проверки, является ли адрес контрактом
     * @param addr проверяемый адрес
     */
    function isContract(address addr) private view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }
    
    /**
     * @dev Извлечение адреса из идентификатора токена
     * @param tokenId идентификатор токена
     */
    function parseAddressFromTokenId(string memory tokenId) private pure returns (address) {
        bytes memory tempBytes = bytes(tokenId);
        
        // Если длина равна длине адреса Ethereum (42 символа включая '0x'), пробуем преобразовать
        if (tempBytes.length == 42) {
            return parseAddress(tokenId);
        }
        
        return address(0);
    }
    
    /**
     * @dev Преобразование строки в адрес
     * @param _address строка адреса
     */
    function parseAddress(string memory _address) private pure returns (address) {
        bytes memory temp = bytes(_address);
        
        // Проверяем, начинается ли с '0x'
        require(temp.length == 42 && temp[0] == '0' && temp[1] == 'x', "Invalid address format");
        
        uint160 result = 0;
        uint160 b1;
        uint160 b2;
        
        for (uint256 i = 2; i < 42; i++) {
            result *= 16;
            
            b1 = uint160(uint8(temp[i]));
            
            if (b1 >= 48 && b1 <= 57) {
                result += (b1 - 48);
            } else if (b1 >= 65 && b1 <= 70) {
                result += (b1 - 55);
            } else if (b1 >= 97 && b1 <= 102) {
                result += (b1 - 87);
            } else {
                revert("Invalid address character");
            }
        }
        
        return address(result);
    }
}

// Интерфейс для получения метаданных ERC20
interface ERC20Metadata {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}