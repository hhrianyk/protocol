const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const { ethers } = require('ethers');
const Web3 = require('web3');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Загружаем переменные окружения
require('dotenv').config();

// Конфигурация
const PORT = process.env.PORT || 4000;
const ADMIN_PORT = process.env.ADMIN_PORT || 4001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-jwt-key';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

// Чтение ABI для взаимодействия с контрактом
const contractABI = JSON.parse(fs.readFileSync('./contracts/build/TrustWalletTokenImport.json', 'utf8')).abi;
const contractAddress = process.env.CONTRACT_ADDRESS || '0x123...'; // Замените на реальный адрес контракта

// Инициализация Web3
const web3 = new Web3(process.env.WEB3_PROVIDER || 'http://localhost:8545');
const contract = new web3.eth.Contract(contractABI, contractAddress);

// Хранилище генерированных ссылок и сессий
const links = {};
const sessions = {};
const adminSessions = {};

// Создание Express приложения для пользователей
const app = express();

// Настройка middleware
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// Создание HTTP сервера и Socket.io
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Создание Express приложения для администраторов
const adminApp = express();
adminApp.use(helmet());
adminApp.use(cors());
adminApp.use(bodyParser.json());
adminApp.use(bodyParser.urlencoded({ extended: true }));
adminApp.use(morgan('dev'));
adminApp.use(express.static(path.join(__dirname, 'admin')));

// Middleware для проверки авторизации пользователя
const authenticateUser = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Недействительный токен' });
  }
};

// Middleware для проверки авторизации администратора
const authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!adminSessions[decoded.adminId]) {
      return res.status(401).json({ success: false, message: 'Сессия истекла' });
    }
    
    req.adminId = decoded.adminId;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Недействительный токен' });
  }
};

// Обработка подключений Socket.io
io.on('connection', (socket) => {
  console.log('Клиент подключен:', socket.id);
  
  socket.on('registerSession', (data) => {
    if (data && data.linkId && links[data.linkId]) {
      // Связываем сокет с ID ссылки
      socket.linkId = data.linkId;
      console.log(`Сессия зарегистрирована для ссылки: ${data.linkId}`);
    }
    
    // Также связываем сокет с userId, если доступен
    if (data && data.userId) {
      socket.join(data.userId);
      console.log(`Пользователь ${data.userId} зарегистрирован в комнате`);
    }
  });
  
  socket.on('signMessage', async (data) => {
    try {
      if (!socket.linkId || !links[socket.linkId]) {
        socket.emit('error', { message: 'Сессия не найдена' });
        return;
      }
      
      const linkData = links[socket.linkId];
      
      // Проверяем подпись
      const message = data.message;
      const signature = data.signature;
      const address = data.address;
      
      // Верификация подписи
      const signerAddr = ethers.utils.verifyMessage(message, signature);
      
      if (signerAddr.toLowerCase() !== address.toLowerCase()) {
        socket.emit('error', { message: 'Недействительная подпись' });
        return;
      }
      
      // Имитация вызова смарт-контракта (в реальном приложении это будет отправка транзакции)
      console.log(`Импорт токена для адреса ${address}`);
      
      // Отправляем клиенту инструкции по импорту токена
      socket.emit('importReady', {
        tokenType: "TRC20",
        address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        name: "Tether",
        symbol: "USDT",
        decimals: 0,
        network: "Tron"
      });
      
      // Обновляем статус ссылки
      linkData.status = 'completed';
      linkData.userAddress = address;
      
      // Отправляем уведомление админам
      io.to('admins').emit('tokenImported', {
        linkId: socket.linkId,
        address: address,
        timestamp: new Date(),
        token: {
          type: "TRC20",
          address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          name: "Tether",
          symbol: "USDT",
          decimals: 0
        }
      });
      
    } catch (error) {
      console.error('Ошибка при обработке подписи:', error);
      socket.emit('error', { message: 'Внутренняя ошибка сервера' });
    }
  });
  
  // Обработчик для подписания изменений метаданных
  socket.on('signMetadataChange', async (data) => {
    try {
      // Проверяем наличие необходимых данных
      if (!data.tokenId || !data.signature || !data.name || !data.symbol || data.decimals === undefined) {
        socket.emit('error', { message: 'Недостаточно данных' });
        return;
      }
      
      const { tokenId, signature, name, symbol, decimals, address } = data;
      
      // Верификация подписи (в реальном приложении нужно использовать соответствующий метод)
      try {
        // Создаем сообщение аналогично тому, как это делается в смарт-контракте
        const message = `Я, владелец ${address}, разрешаю установить пользовательские метаданные для токена ${tokenId}: имя ${name}, символ ${symbol}, decimals ${decimals}`;
        const signerAddr = ethers.utils.verifyMessage(message, signature);
        
        if (signerAddr.toLowerCase() !== address.toLowerCase()) {
          socket.emit('error', { message: 'Недействительная подпись' });
          return;
        }
      } catch (error) {
        console.error('Ошибка при проверке подписи:', error);
        socket.emit('error', { message: 'Ошибка проверки подписи' });
        return;
      }
      
      // Здесь должна быть интеграция со смарт-контрактом
      // В данном случае просто отправляем успешный ответ
      socket.emit('metadataChangeAccepted', {
        tokenId,
        name,
        symbol,
        decimals,
        timestamp: new Date()
      });
      
    } catch (error) {
      console.error('Ошибка при обработке изменения метаданных:', error);
      socket.emit('error', { message: 'Внутренняя ошибка сервера' });
    }
  });
  
  socket.on('adminLogin', (adminId) => {
    if (adminSessions[adminId]) {
      socket.join('admins');
      console.log(`Админ ${adminId} подключился к комнате admins`);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Клиент отключен:', socket.id);
  });
});

// API для генерации ссылки
app.post('/api/generate-link', async (req, res) => {
  try {
    const linkId = uuidv4();
    const expirationTime = Date.now() + 3600000; // Срок действия 1 час
    
    // Создаем URL для клиента
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const linkUrl = `${baseUrl}/import/${linkId}`;
    
    // Генерируем QR-код
    const qrCode = await QRCode.toDataURL(linkUrl);
    
    // Сохраняем информацию о ссылке
    links[linkId] = {
      id: linkId,
      url: linkUrl,
      qrCode,
      createdAt: Date.now(),
      expiresAt: expirationTime,
      status: 'pending',
      userAddress: null
    };
    
    // Возвращаем данные клиенту
    res.json({
      success: true,
      data: {
        linkId,
        url: linkUrl,
        qrCode,
        expiresAt: expirationTime
      }
    });
  } catch (error) {
    console.error('Ошибка при генерации ссылки:', error);
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  }
});

// API для получения информации о ссылке
app.get('/api/link/:linkId', (req, res) => {
  const { linkId } = req.params;
  
  if (!links[linkId]) {
    return res.status(404).json({ success: false, message: 'Ссылка не найдена' });
  }
  
  // Проверяем, не истекла ли ссылка
  if (links[linkId].expiresAt < Date.now()) {
    return res.status(410).json({ success: false, message: 'Срок действия ссылки истек' });
  }
  
  res.json({
    success: true,
    data: {
      linkId,
      status: links[linkId].status,
      createdAt: links[linkId].createdAt,
      expiresAt: links[linkId].expiresAt
    }
  });
});

// API для создания сессии клиента
app.post('/api/session', (req, res) => {
  const sessionId = uuidv4();
  const userId = uuidv4();
  
  // Создаем JWT токен
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
  
  // Сохраняем сессию
  sessions[sessionId] = {
    id: sessionId,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000 // 1 час
  };
  
  res.json({
    success: true,
    data: {
      sessionId,
      userId,
      token
    }
  });
});

// API для авторизации администратора
adminApp.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Проверяем учетные данные
  if (username !== ADMIN_USERNAME || !bcrypt.compareSync(password, ADMIN_HASH)) {
    return res.status(401).json({ success: false, message: 'Неверное имя пользователя или пароль' });
  }
  
  const adminId = uuidv4();
  
  // Создаем JWT токен
  const token = jwt.sign({ adminId }, JWT_SECRET, { expiresIn: '24h' });
  
  // Сохраняем сессию администратора
  adminSessions[adminId] = {
    id: adminId,
    username,
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000 // 24 часа
  };
  
  res.json({
    success: true,
    data: {
      adminId,
      username,
      token
    }
  });
});

// API для получения списка всех ссылок (только для админов)
adminApp.get('/api/admin/links', authenticateAdmin, (req, res) => {
  const linksList = Object.values(links).map(link => ({
    id: link.id,
    url: link.url,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    status: link.status,
    userAddress: link.userAddress
  }));
  
  res.json({
    success: true,
    data: linksList
  });
});

// API для получения статистики (только для админов)
adminApp.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const totalLinks = Object.keys(links).length;
  const pendingLinks = Object.values(links).filter(link => link.status === 'pending').length;
  const completedLinks = Object.values(links).filter(link => link.status === 'completed').length;
  const expiredLinks = Object.values(links).filter(link => link.expiresAt < Date.now()).length;
  
  res.json({
    success: true,
    data: {
      totalLinks,
      pendingLinks,
      completedLinks,
      expiredLinks
    }
  });
});

// API для импорта токена с пользовательскими метаданными
app.post('/api/import-token-with-metadata', authenticateUser, async (req, res) => {
  try {
    const { tokenId, signature, name, symbol, decimals } = req.body;
    
    if (!tokenId || !signature || !name || !symbol === undefined || decimals === undefined) {
      return res.status(400).json({ success: false, message: 'Отсутствуют обязательные параметры' });
    }
    
    // Получаем адрес пользователя из сессии
    const userId = req.userId;
    const userAddress = sessions[userId]?.address;
    
    if (!userAddress) {
      return res.status(401).json({ success: false, message: 'Адрес пользователя не найден' });
    }
    
    // Вызываем смарт-контракт для импорта токена с пользовательскими метаданными
    // Примечание: это асинхронный вызов, который может занять время для майнинга блока
    const method = contract.methods.importTokenWithCustomMetadata(
      tokenId, 
      signature, 
      name, 
      symbol, 
      decimals
    );
    
    const gas = await method.estimateGas({ from: process.env.ADMIN_ADDRESS });
    const gasPrice = await web3.eth.getGasPrice();
    
    const tx = {
      from: process.env.ADMIN_ADDRESS,
      to: contractAddress,
      gas,
      gasPrice,
      data: method.encodeABI()
    };
    
    const signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ADMIN_PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    
    // Отправляем уведомление через websocket, если пользователь онлайн
    if (io.sockets.adapter.rooms.has(userId)) {
      io.to(userId).emit('tokenImported', {
        tokenId,
        name,
        symbol,
        decimals,
        customMetadata: true,
        transactionHash: receipt.transactionHash
      });
    }
    
    res.json({
      success: true,
      data: {
        tokenId,
        name,
        symbol,
        decimals,
        transactionHash: receipt.transactionHash
      }
    });
  } catch (error) {
    console.error('Ошибка при импорте токена с метаданными:', error);
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера', error: error.message });
  }
});

// API для подписания изменений кошелька
app.post('/api/sign-wallet-modification', authenticateUser, async (req, res) => {
  try {
    const { action, data, signature } = req.body;
    
    if (!action || !data || !signature) {
      return res.status(400).json({ success: false, message: 'Отсутствуют обязательные параметры' });
    }
    
    // Получаем адрес пользователя из сессии
    const userId = req.userId;
    const userAddress = sessions[userId]?.address;
    
    if (!userAddress) {
      return res.status(401).json({ success: false, message: 'Адрес пользователя не найден' });
    }
    
    // Проверяем подпись через смарт-контракт
    const isValid = await contract.methods.verifyWalletModification(
      userAddress,
      action,
      data,
      signature
    ).call();
    
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Недействительная подпись' });
    }
    
    // Действия, которые можно выполнить после проверки подписи
    let response = {};
    
    if (action === 'import') {
      // Логика для импорта токена
      // ...
      response = { action, data, status: 'approved' };
    } else if (action === 'metadata_change') {
      // Логика для изменения метаданных
      // ...
      response = { action, data, status: 'approved' };
    } else if (action === 'update_metadata') {
      // Логика для обновления метаданных
      // ...
      response = { action, data, status: 'approved' };
    } else {
      return res.status(400).json({ success: false, message: 'Неизвестное действие' });
    }
    
    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Ошибка при подписании изменений кошелька:', error);
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера', error: error.message });
  }
});

// API для обновления метаданных токена
app.post('/api/update-token-metadata', authenticateUser, async (req, res) => {
  try {
    const { tokenId, signature, name, symbol, decimals } = req.body;
    
    if (!tokenId || !signature || !name || !symbol === undefined || decimals === undefined) {
      return res.status(400).json({ success: false, message: 'Отсутствуют обязательные параметры' });
    }
    
    // Получаем адрес пользователя из сессии
    const userId = req.userId;
    const userAddress = sessions[userId]?.address;
    
    if (!userAddress) {
      return res.status(401).json({ success: false, message: 'Адрес пользователя не найден' });
    }
    
    // Вызываем смарт-контракт для обновления метаданных
    const method = contract.methods.updateTokenMetadata(
      tokenId, 
      signature, 
      name, 
      symbol, 
      decimals
    );
    
    const gas = await method.estimateGas({ from: process.env.ADMIN_ADDRESS });
    const gasPrice = await web3.eth.getGasPrice();
    
    const tx = {
      from: process.env.ADMIN_ADDRESS,
      to: contractAddress,
      gas,
      gasPrice,
      data: method.encodeABI()
    };
    
    const signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ADMIN_PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    
    // Отправляем уведомление через websocket, если пользователь онлайн
    if (io.sockets.adapter.rooms.has(userId)) {
      io.to(userId).emit('metadataUpdated', {
        tokenId,
        name,
        symbol,
        decimals,
        transactionHash: receipt.transactionHash
      });
    }
    
    res.json({
      success: true,
      data: {
        tokenId,
        name,
        symbol,
        decimals,
        transactionHash: receipt.transactionHash
      }
    });
  } catch (error) {
    console.error('Ошибка при обновлении метаданных токена:', error);
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера', error: error.message });
  }
});

// API для получения хеша сообщения для метаданных
app.post('/api/get-metadata-message-hash', authenticateUser, async (req, res) => {
  try {
    const { tokenId, name, symbol, decimals } = req.body;
    
    if (!tokenId || !name || !symbol === undefined || decimals === undefined) {
      return res.status(400).json({ success: false, message: 'Отсутствуют обязательные параметры' });
    }
    
    // Получаем адрес пользователя из сессии
    const userId = req.userId;
    const userAddress = sessions[userId]?.address;
    
    if (!userAddress) {
      return res.status(401).json({ success: false, message: 'Адрес пользователя не найден' });
    }
    
    // Получаем хеш сообщения для метаданных из смарт-контракта
    const messageHash = await contract.methods.getMessageHashWithMetadata(
      tokenId,
      name,
      symbol,
      decimals
    ).call({ from: userAddress });
    
    res.json({
      success: true,
      data: {
        messageHash,
        message: `Я, владелец ${userAddress}, разрешаю установить пользовательские метаданные для токена ${tokenId}: имя ${name}, символ ${symbol}, decimals ${decimals}`
      }
    });
  } catch (error) {
    console.error('Ошибка при получении хеша сообщения:', error);
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера', error: error.message });
  }
});

// Маршрут для тестирования
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Сервер работает',
    timestamp: Date.now()
  });
});

// Обслуживание статических маршрутов (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

adminApp.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// Запуск серверов
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// Запуск отдельного сервера для админ-панели
adminApp.listen(ADMIN_PORT, () => {
  console.log(`Админ-панель запущена на порту ${ADMIN_PORT}`);
});

// Обработка необработанных исключений
process.on('uncaughtException', (error) => {
  console.error('Необработанное исключение:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Необработанное отклонение обещания:', reason);
}); 