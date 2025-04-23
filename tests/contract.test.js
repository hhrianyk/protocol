const { expect } = require('chai');
const { ethers } = require('hardhat');

describe("TrustWalletTokenImport", function() {
  let trustWalletTokenImport;
  let owner;
  let user1;
  let user2;
  let signers;
  let uniswapRouter;

  // Константы для тестов
  const USDT_TRC20_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"));
  const MODERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MODERATOR_ROLE"));

  beforeEach(async function() {
    // Получаем аккаунты
    [owner, user1, user2, ...signers] = await ethers.getSigners();
    
    // Деплоим mock для Uniswap Router
    const MockUniswapRouter = await ethers.getContractFactory("MockUniswapRouter");
    uniswapRouter = await MockUniswapRouter.deploy();
    
    // Деплоим контракт
    const TrustWalletTokenImport = await ethers.getContractFactory("TrustWalletTokenImport");
    trustWalletTokenImport = await TrustWalletTokenImport.deploy(
      [owner.address, signers[0].address, signers[1].address],
      2,
      uniswapRouter.address
    );
    
    // Ждем завершения деплоя
    await trustWalletTokenImport.deployed();
  });

  describe("Инициализация", function() {
    it("Должен установить правильные начальные параметры", async function() {
      // Проверяем, что владелец имеет роль ADMIN
      expect(await trustWalletTokenImport.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
      
      // Проверяем значение константы USDT_TRC20_ADDRESS
      expect(await trustWalletTokenImport.USDT_TRC20_ADDRESS()).to.equal(USDT_TRC20_ADDRESS);
      
      // Проверяем правильно ли установлен адрес Uniswap Router
      expect(await trustWalletTokenImport.uniswapRouter()).to.equal(uniswapRouter.address);
    });
  });

  describe("Управление ролями", function() {
    it("Владелец должен иметь возможность назначать роли", async function() {
      // Назначаем роль MODERATOR пользователю user1
      await trustWalletTokenImport.grantRole(MODERATOR_ROLE, user1.address);
      
      // Проверяем, что роль успешно назначена
      expect(await trustWalletTokenImport.hasRole(MODERATOR_ROLE, user1.address)).to.be.true;
    });

    it("Пользователь без роли ADMIN не должен иметь возможность назначать роли", async function() {
      // Пытаемся назначить роль MODERATOR от имени user1, у которого нет роли ADMIN
      await expect(
        trustWalletTokenImport.connect(user1).grantRole(MODERATOR_ROLE, user2.address)
      ).to.be.reverted;
    });
  });

  describe("Импорт токенов", function() {
    it("Пользователь должен иметь возможность импортировать токен", async function() {
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись
      const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
      
      // Импортируем токен
      await trustWalletTokenImport.connect(user1).importToken(tokenId, signature);
      
      // Проверяем, что токен был успешно импортирован
      const isValid = await trustWalletTokenImport.isValidImport(user1.address, tokenId);
      expect(isValid).to.be.true;
    });

    it("Пользователь не должен иметь возможность импортировать токен повторно", async function() {
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись
      const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
      
      // Импортируем токен в первый раз
      await trustWalletTokenImport.connect(user1).importToken(tokenId, signature);
      
      // Пытаемся импортировать тот же токен повторно
      await expect(
        trustWalletTokenImport.connect(user1).importToken(tokenId, signature)
      ).to.be.revertedWith("Token already imported");
    });

    it("Пользователь не должен иметь возможность импортировать токен с неверной подписью", async function() {
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись другим пользователем
      const signature = await user2.signMessage(ethers.utils.arrayify(messageHash));
      
      // Пытаемся импортировать токен с неверной подписью
      await expect(
        trustWalletTokenImport.connect(user1).importToken(tokenId, signature)
      ).to.be.revertedWith("Invalid signature");
    });
  });

  describe("Пакетный импорт токенов", function() {
    it("Пользователь должен иметь возможность импортировать несколько токенов за одну транзакцию", async function() {
      const tokenIds = [USDT_TRC20_ADDRESS, "token2"];
      const signatures = [];
      
      for (let i = 0; i < tokenIds.length; i++) {
        const messageHash = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "string", "uint256"],
            [user1.address, tokenIds[i], (await ethers.provider.getBlock()).timestamp]
          )
        );
        
        // Создаем подпись
        const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
        signatures.push(signature);
      }
      
      // Импортируем токены пакетно
      await trustWalletTokenImport.connect(user1).batchImportTokens(tokenIds, signatures);
      
      // Проверяем, что токены были успешно импортированы
      for (let i =.0; i < tokenIds.length; i++) {
        const isValid = await trustWalletTokenImport.isValidImport(user1.address, tokenIds[i]);
        expect(isValid).to.be.true;
      }
    });
  });

  describe("Отзыв импорта", function() {
    it("Пользователь должен иметь возможность отозвать импорт своего токена", async function() {
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись
      const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
      
      // Импортируем токен
      await trustWalletTokenImport.connect(user1).importToken(tokenId, signature);
      
      // Отзываем импорт
      await trustWalletTokenImport.connect(user1).revokeImport(tokenId);
      
      // Проверяем, что импорт был отозван
      const isValid = await trustWalletTokenImport.isValidImport(user1.address, tokenId);
      expect(isValid).to.be.false;
    });

    it("Пользователь не должен иметь возможность отозвать импорт чужого токена", async function() {
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись
      const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
      
      // Импортируем токен
      await trustWalletTokenImport.connect(user1).importToken(tokenId, signature);
      
      // Пытаемся отозвать импорт от имени другого пользователя
      await expect(
        trustWalletTokenImport.connect(user2).revokeImport(tokenId)
      ).to.be.revertedWith("Token not imported");
    });
  });

  describe("Продление срока действия импорта", function() {
    it("Пользователь должен иметь возможность продлить срок действия импорта", async function() {
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись
      const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
      
      // Импортируем токен
      await trustWalletTokenImport.connect(user1).importToken(tokenId, signature);
      
      // Запоминаем время до продления
      const tokenInfoBefore = await trustWalletTokenImport.getTokenInfo(user1.address, tokenId);
      
      // Ждем небольшое время
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");
      
      // Продлеваем срок действия
      await trustWalletTokenImport.connect(user1).renewImport(tokenId);
      
      // Проверяем, что время было обновлено
      const tokenInfoAfter = await trustWalletTokenImport.getTokenInfo(user1.address, tokenId);
      expect(tokenInfoAfter.timestamp).to.be.gt(tokenInfoBefore.timestamp);
    });
  });

  describe("Мультиподпись", function() {
    it("Должен правильно создавать и утверждать предложения мультиподписи", async function() {
      // Создаем функцию для вызова через мультиподпись
      const newTimeout = 48 * 3600; // 48 часов
      const data = trustWalletTokenImport.interface.encodeFunctionData("setDefaultTimeout", [newTimeout]);
      
      // Создаем предложение
      await trustWalletTokenImport.connect(owner).proposeMultiSig(data);
      
      // Подтверждаем предложение другими подписантами
      await trustWalletTokenImport.connect(signers[0]).approveMultiSig(0);
      
      // Проверяем, что таймаут изменился после достаточного количества утверждений
      expect(await trustWalletTokenImport.defaultImportTimeout()).to.equal(newTimeout);
    });
  });

  describe("Интеграция с Uniswap", function() {
    it("Должен корректно проводить обмен токенов через Uniswap", async function() {
      // Деплоим ERC20 токен для теста
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Test Token", "TEST", 18);
      await token.deployed();
      
      // Минтим токены пользователю
      await token.mint(user1.address, ethers.utils.parseEther("100"));
      
      // Аппрувим токены для контракта
      await token.connect(user1).approve(trustWalletTokenImport.address, ethers.utils.parseEther("10"));
      
      // Вызываем обмен токенов
      await trustWalletTokenImport.connect(user1).swapExactTokensForTokens(
        token.address,
        ethers.utils.parseEther("10"),
        ethers.utils.parseEther("5"),
        [token.address, user2.address], // Путь обмена
        Math.floor(Date.now() / 1000) + 3600 // Дедлайн через час
      );
      
      // Проверка будет зависеть от реализации mock-контракта Uniswap
    });
  });

  describe("Таймаут и категории токенов", function() {
    it("Должен корректно применять таймауты для категорий токенов", async function() {
      // Устанавливаем таймаут для категории TRC20
      const data = trustWalletTokenImport.interface.encodeFunctionData("setCategoryTimeout", ["TRC20", 72 * 3600]);
      
      // Создаем предложение
      await trustWalletTokenImport.connect(owner).proposeMultiSig(data);
      
      // Подтверждаем предложение другими подписантами
      await trustWalletTokenImport.connect(signers[0]).approveMultiSig(0);
      
      // Импортируем токен TRC20
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись
      const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
      
      // Импортируем токен
      await trustWalletTokenImport.connect(user1).importToken(tokenId, signature);
      
      // Получаем информацию о токене и проверяем таймаут
      const tokenInfo = await trustWalletTokenImport.getTokenInfo(user1.address, tokenId);
      expect(tokenInfo.timeout).to.equal(72 * 3600);
    });
  });

  describe("Система управления доступом", function() {
    it("Админ должен иметь возможность приостановить контракт", async function() {
      // Приостанавливаем контракт
      await trustWalletTokenImport.connect(owner).pause();
      
      // Пытаемся импортировать токен
      const tokenId = USDT_TRC20_ADDRESS;
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "string", "uint256"],
          [user1.address, tokenId, (await ethers.provider.getBlock()).timestamp]
        )
      );
      
      // Создаем подпись
      const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
      
      // Импорт должен быть отклонен
      await expect(
        trustWalletTokenImport.connect(user1).importToken(tokenId, signature)
      ).to.be.revertedWith("Pausable: paused");
      
      // Возобновляем контракт
      await trustWalletTokenImport.connect(owner).unpause();
      
      // Теперь импорт должен работать
      await trustWalletTokenImport.connect(user1).importToken(tokenId, signature);
    });
  });
}); 