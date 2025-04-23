// Основные переменные
let token = null;
let adminId = null;
let socket = null;
let currentPage = 'login';
let linkData = {};
let activities = [];

// Получаем элементы DOM
const pages = {
    login: document.getElementById('login-page'),
    dashboard: document.getElementById('dashboard-page'),
    links: document.getElementById('links-page'),
    generate: document.getElementById('generate-page'),
    settings: document.getElementById('settings-page')
};

const elements = {
    loginForm: document.getElementById('login-form'),
    loginError: document.getElementById('login-error'),
    navItems: document.querySelectorAll('.sidebar-nav li'),
    pageTitle: document.getElementById('page-title'),
    userName: document.getElementById('user-name'),
    logoutBtn: document.getElementById('logout-btn'),
    toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),
    sidebar: document.querySelector('.sidebar'),
    mainContent: document.querySelector('.main-content'),
    topbar: document.querySelector('.topbar'),
    
    // Статистика
    totalLinks: document.getElementById('total-links'),
    completedLinks: document.getElementById('completed-links'),
    pendingLinks: document.getElementById('pending-links'),
    expiredLinks: document.getElementById('expired-links'),
    activityList: document.getElementById('activity-list'),
    
    // Таблица ссылок
    linksTableBody: document.getElementById('links-table-body'),
    linksEmptyState: document.getElementById('links-empty-state'),
    linksLoading: document.getElementById('links-loading'),
    refreshLinksBtn: document.getElementById('refresh-links-btn'),
    addLinkBtn: document.getElementById('add-link-btn'),
    
    // Генерация ссылок
    generateLinkBtn: document.getElementById('generate-link-btn'),
    generatedLinkContainer: document.getElementById('generated-link-container'),
    qrCode: document.getElementById('qr-code'),
    generatedUrl: document.getElementById('generated-url'),
    expirationTime: document.getElementById('expiration-time'),
    copyUrlBtn: document.getElementById('copy-url-btn'),
    downloadQrBtn: document.getElementById('download-qr-btn'),
    createAnotherLinkBtn: document.getElementById('create-another-link-btn'),
    
    // Настройки
    linkExpiration: document.getElementById('link-expiration'),
    baseUrl: document.getElementById('base-url'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    currentPassword: document.getElementById('current-password'),
    newPassword: document.getElementById('new-password'),
    confirmPassword: document.getElementById('confirm-password'),
    passwordError: document.getElementById('password-error'),
    changePasswordBtn: document.getElementById('change-password-btn'),
    
    // Модальное окно
    linkModal: document.getElementById('link-modal'),
    closeModalBtns: document.querySelectorAll('.close-modal-btn'),
    modalLinkId: document.getElementById('modal-link-id'),
    modalLinkUrl: document.getElementById('modal-link-url'),
    modalLinkStatus: document.getElementById('modal-link-status'),
    modalUserAddress: document.getElementById('modal-user-address'),
    modalCreatedAt: document.getElementById('modal-created-at'),
    modalExpiresAt: document.getElementById('modal-expires-at'),
    modalQrCode: document.getElementById('modal-qr-code'),
    copyModalUrlBtn: document.querySelector('.copy-modal-url-btn')
};

// Инициализация
function init() {
    // Проверяем, есть ли токен в localStorage
    token = localStorage.getItem('adminToken');
    adminId = localStorage.getItem('adminId');
    
    if (token) {
        // Проверяем валидность токена
        fetch('/api/admin/stats', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            if (response.ok) {
                // Токен валидный
                elements.userName.textContent = localStorage.getItem('adminUsername') || 'Admin';
                showPage('dashboard');
                loadDashboardData();
                setupSocket();
            } else {
                // Токен невалидный или истек
                logout();
            }
        })
        .catch(error => {
            console.error('Ошибка при проверке токена:', error);
            logout();
        });
    } else {
        showPage('login');
    }
    
    // Устанавливаем обработчики событий
    setupEventListeners();
}

// Установка Socket.IO
function setupSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Соединение с сокетом установлено');
        socket.emit('adminLogin', adminId);
    });
    
    socket.on('tokenImported', (data) => {
        console.log('Токен импортирован:', data);
        
        // Добавляем новую активность
        addActivity({
            type: 'import',
            data: data
        });
        
        // Обновляем статистику
        loadDashboardData();
        
        // Обновляем список ссылок, если мы на странице ссылок
        if (currentPage === 'links') {
            loadLinks();
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Соединение с сокетом закрыто');
    });
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Форма входа
    elements.loginForm.addEventListener('submit', handleLogin);
    
    // Навигация
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageName = item.getAttribute('data-page');
            showPage(pageName);
            
            if (pageName === 'dashboard') {
                loadDashboardData();
            } else if (pageName === 'links') {
                loadLinks();
            }
        });
    });
    
    // Кнопка выхода
    elements.logoutBtn.addEventListener('click', logout);
    
    // Переключение боковой панели на мобильных устройствах
    elements.toggleSidebarBtn.addEventListener('click', () => {
        elements.sidebar.classList.toggle('visible');
    });
    
    // Кнопки на странице ссылок
    elements.refreshLinksBtn.addEventListener('click', loadLinks);
    elements.addLinkBtn.addEventListener('click', () => showPage('generate'));
    
    // Кнопки на странице генерации ссылок
    elements.generateLinkBtn.addEventListener('click', generateLink);
    elements.copyUrlBtn.addEventListener('click', copyToClipboard);
    elements.downloadQrBtn.addEventListener('click', downloadQRCode);
    elements.createAnotherLinkBtn.addEventListener('click', resetGeneratePage);
    
    // Кнопки на странице настроек
    elements.saveSettingsBtn.addEventListener('click', saveSettings);
    elements.changePasswordBtn.addEventListener('click', changePassword);
    
    // Кнопки закрытия модального окна
    elements.closeModalBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.linkModal.classList.add('hidden');
        });
    });
    
    // Копирование URL в модальном окне
    elements.copyModalUrlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(elements.modalLinkUrl.value)
            .then(() => {
                alert('URL скопирован в буфер обмена');
            })
            .catch(err => {
                console.error('Ошибка при копировании:', err);
            });
    });
}

// Обработка входа
function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
        showLoginError('Пожалуйста, введите имя пользователя и пароль');
        return;
    }
    
    fetch('/api/admin/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Сохраняем токен
            token = data.data.token;
            adminId = data.data.adminId;
            localStorage.setItem('adminToken', token);
            localStorage.setItem('adminId', adminId);
            localStorage.setItem('adminUsername', data.data.username);
            
            // Обновляем UI
            elements.userName.textContent = data.data.username;
            
            // Переходим на дашборд
            showPage('dashboard');
            loadDashboardData();
            setupSocket();
        } else {
            showLoginError(data.message || 'Ошибка входа');
        }
    })
    .catch(error => {
        console.error('Ошибка при входе:', error);
        showLoginError('Ошибка сервера. Попробуйте позже.');
    });
}

// Показать ошибку входа
function showLoginError(message) {
    elements.loginError.textContent = message;
    elements.loginError.classList.remove('hidden');
}

// Выход из системы
function logout() {
    // Удаляем токен
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminId');
    localStorage.removeItem('adminUsername');
    
    // Сбрасываем переменные
    token = null;
    adminId = null;
    
    // Закрываем соединение с сокетом
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    // Переходим на страницу входа
    showPage('login');
}

// Показать определенную страницу
function showPage(pageName) {
    currentPage = pageName;
    
    // Скрываем все страницы
    Object.values(pages).forEach(page => {
        page.classList.add('hidden');
    });
    
    // Показываем нужную страницу
    pages[pageName].classList.remove('hidden');
    
    // Обновляем активный пункт меню
    elements.navItems.forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-page') === pageName) {
            item.classList.add('active');
        }
    });
    
    // Обновляем заголовок
    if (pageName === 'dashboard') {
        elements.pageTitle.textContent = 'Панель управления';
    } else if (pageName === 'links') {
        elements.pageTitle.textContent = 'Управление ссылками';
    } else if (pageName === 'generate') {
        elements.pageTitle.textContent = 'Создание ссылки';
    } else if (pageName === 'settings') {
        elements.pageTitle.textContent = 'Настройки';
    }
    
    // На мобильных устройствах скрываем боковую панель после выбора страницы
    if (window.innerWidth <= 768) {
        elements.sidebar.classList.remove('visible');
    }
}

// Загрузка данных для дашборда
function loadDashboardData() {
    fetch('/api/admin/stats', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Обновляем статистику
            elements.totalLinks.textContent = data.data.totalLinks;
            elements.completedLinks.textContent = data.data.completedLinks;
            elements.pendingLinks.textContent = data.data.pendingLinks;
            elements.expiredLinks.textContent = data.data.expiredLinks;
        }
    })
    .catch(error => {
        console.error('Ошибка при загрузке статистики:', error);
    });
    
    // Загружаем список ссылок для получения активности
    loadLinks(true);
}

// Загрузка списка ссылок
function loadLinks(forDashboard = false) {
    if (!forDashboard) {
        elements.linksEmptyState.classList.add('hidden');
        elements.linksLoading.classList.remove('hidden');
        elements.linksTableBody.innerHTML = '';
    }
    
    fetch('/api/admin/links', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            linkData = data.data.reduce((acc, link) => {
                acc[link.id] = link;
                return acc;
            }, {});
            
            if (forDashboard) {
                // Для дашборда нам нужны только последние активности
                createActivityList(data.data);
            } else {
                // Для страницы ссылок создаем таблицу
                createLinksTable(data.data);
            }
        }
    })
    .catch(error => {
        console.error('Ошибка при загрузке ссылок:', error);
        if (!forDashboard) {
            elements.linksLoading.classList.add('hidden');
            elements.linksEmptyState.classList.remove('hidden');
        }
    });
}

// Создание таблицы ссылок
function createLinksTable(links) {
    elements.linksLoading.classList.add('hidden');
    
    if (!links || links.length === 0) {
        elements.linksEmptyState.classList.remove('hidden');
        return;
    }
    
    links.sort((a, b) => b.createdAt - a.createdAt);
    
    links.forEach(link => {
        const row = document.createElement('tr');
        
        // ID
        const idCell = document.createElement('td');
        idCell.textContent = link.id.substring(0, 8) + '...';
        row.appendChild(idCell);
        
        // URL
        const urlCell = document.createElement('td');
        const urlText = document.createElement('span');
        urlText.textContent = link.url.substring(0, 30) + '...';
        urlCell.appendChild(urlText);
        row.appendChild(urlCell);
        
        // Статус
        const statusCell = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.classList.add('status-badge');
        
        if (link.expiresAt < Date.now()) {
            statusBadge.classList.add('expired');
            statusBadge.textContent = 'Истек';
        } else if (link.status === 'completed') {
            statusBadge.classList.add('completed');
            statusBadge.textContent = 'Завершен';
        } else {
            statusBadge.classList.add('pending');
            statusBadge.textContent = 'Ожидание';
        }
        
        statusCell.appendChild(statusBadge);
        row.appendChild(statusCell);
        
        // Адрес пользователя
        const addressCell = document.createElement('td');
        addressCell.textContent = link.userAddress ? (link.userAddress.substring(0, 10) + '...') : '-';
        row.appendChild(addressCell);
        
        // Дата создания
        const createdCell = document.createElement('td');
        createdCell.textContent = new Date(link.createdAt).toLocaleString();
        row.appendChild(createdCell);
        
        // Срок действия
        const expiresCell = document.createElement('td');
        expiresCell.textContent = new Date(link.expiresAt).toLocaleString();
        row.appendChild(expiresCell);
        
        // Действия
        const actionsCell = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.classList.add('table-actions');
        
        const viewBtn = document.createElement('button');
        viewBtn.classList.add('btn-icon');
        viewBtn.innerHTML = '<i class="fas fa-eye"></i>';
        viewBtn.addEventListener('click', () => showLinkDetails(link.id));
        
        actionsDiv.appendChild(viewBtn);
        actionsCell.appendChild(actionsDiv);
        row.appendChild(actionsCell);
        
        elements.linksTableBody.appendChild(row);
    });
}

// Создание списка активностей
function createActivityList(links) {
    // Получаем только последние 5 активностей (завершенные импорты)
    const completedLinks = links
        .filter(link => link.status === 'completed')
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5);
    
    if (completedLinks.length === 0) {
        elements.activityList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-info-circle"></i>
                <p>Нет недавних активностей</p>
            </div>
        `;
        return;
    }
    
    elements.activityList.innerHTML = '';
    
    completedLinks.forEach(link => {
        const activityItem = document.createElement('div');
        activityItem.classList.add('activity-item');
        
        const activityIcon = document.createElement('div');
        activityIcon.classList.add('activity-icon', 'green');
        activityIcon.innerHTML = '<i class="fas fa-check"></i>';
        
        const activityDetail = document.createElement('div');
        activityDetail.classList.add('activity-detail');
        
        const activityText = document.createElement('p');
        activityText.innerHTML = `Токен импортирован пользователем <strong>${link.userAddress.substring(0, 10)}...</strong>`;
        
        const activityTime = document.createElement('small');
        activityTime.textContent = new Date(link.createdAt).toLocaleString();
        
        activityDetail.appendChild(activityText);
        activityDetail.appendChild(activityTime);
        
        activityItem.appendChild(activityIcon);
        activityItem.appendChild(activityDetail);
        
        elements.activityList.appendChild(activityItem);
    });
}

// Добавление новой активности
function addActivity(activity) {
    activities.unshift(activity);
    activities = activities.slice(0, 10); // Храним только 10 последних активностей
    
    if (currentPage === 'dashboard') {
        const activityItem = document.createElement('div');
        activityItem.classList.add('activity-item');
        
        const activityIcon = document.createElement('div');
        activityIcon.classList.add('activity-icon', 'green');
        activityIcon.innerHTML = '<i class="fas fa-check"></i>';
        
        const activityDetail = document.createElement('div');
        activityDetail.classList.add('activity-detail');
        
        const activityText = document.createElement('p');
        activityText.innerHTML = `Токен импортирован пользователем <strong>${activity.data.address.substring(0, 10)}...</strong>`;
        
        const activityTime = document.createElement('small');
        activityTime.textContent = new Date().toLocaleString();
        
        activityDetail.appendChild(activityText);
        activityDetail.appendChild(activityTime);
        
        activityItem.appendChild(activityIcon);
        activityItem.appendChild(activityDetail);
        
        // Добавляем в начало списка
        if (elements.activityList.querySelector('.empty-state')) {
            elements.activityList.innerHTML = '';
        }
        
        if (elements.activityList.firstChild) {
            elements.activityList.insertBefore(activityItem, elements.activityList.firstChild);
        } else {
            elements.activityList.appendChild(activityItem);
        }
    }
}

// Показать детали ссылки
function showLinkDetails(linkId) {
    const link = linkData[linkId];
    if (!link) return;
    
    elements.modalLinkId.textContent = link.id;
    elements.modalLinkUrl.value = link.url;
    
    if (link.expiresAt < Date.now()) {
        elements.modalLinkStatus.textContent = 'Истек';
    } else if (link.status === 'completed') {
        elements.modalLinkStatus.textContent = 'Завершен';
    } else {
        elements.modalLinkStatus.textContent = 'Ожидание';
    }
    
    elements.modalUserAddress.textContent = link.userAddress || '-';
    elements.modalCreatedAt.textContent = new Date(link.createdAt).toLocaleString();
    elements.modalExpiresAt.textContent = new Date(link.expiresAt).toLocaleString();
    
    // Получаем QR-код из данных ссылки, если он есть
    if (link.qrCode) {
        elements.modalQrCode.src = link.qrCode;
        elements.modalQrCode.classList.remove('hidden');
    } else {
        elements.modalQrCode.classList.add('hidden');
    }
    
    elements.linkModal.classList.remove('hidden');
}

// Генерация новой ссылки
function generateLink() {
    elements.generateLinkBtn.disabled = true;
    elements.generateLinkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Генерация...';
    
    fetch('/api/generate-link', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            elements.qrCode.src = data.data.qrCode;
            elements.generatedUrl.value = data.data.url;
            elements.expirationTime.value = new Date(data.data.expiresAt).toLocaleString();
            
            elements.generatedLinkContainer.classList.remove('hidden');
            elements.generateLinkBtn.classList.add('hidden');
        } else {
            alert('Ошибка при генерации ссылки: ' + (data.message || 'Неизвестная ошибка'));
        }
    })
    .catch(error => {
        console.error('Ошибка при генерации ссылки:', error);
        alert('Ошибка сервера при генерации ссылки');
    })
    .finally(() => {
        elements.generateLinkBtn.disabled = false;
        elements.generateLinkBtn.innerHTML = '<i class="fas fa-magic"></i> Сгенерировать ссылку';
    });
}

// Сбросить страницу генерации ссылок
function resetGeneratePage() {
    elements.generatedLinkContainer.classList.add('hidden');
    elements.generateLinkBtn.classList.remove('hidden');
}

// Копировать URL в буфер обмена
function copyToClipboard() {
    navigator.clipboard.writeText(elements.generatedUrl.value)
        .then(() => {
            alert('URL скопирован в буфер обмена');
        })
        .catch(err => {
            console.error('Ошибка при копировании:', err);
        });
}

// Скачать QR-код
function downloadQRCode() {
    const link = document.createElement('a');
    link.download = 'qrcode.png';
    link.href = elements.qrCode.src;
    link.click();
}

// Сохранить настройки
function saveSettings() {
    const linkExpiration = elements.linkExpiration.value;
    const baseUrl = elements.baseUrl.value;
    
    // В реальном приложении здесь был бы запрос к API
    localStorage.setItem('linkExpiration', linkExpiration);
    localStorage.setItem('baseUrl', baseUrl);
    
    alert('Настройки сохранены');
}

// Изменить пароль
function changePassword() {
    const currentPassword = elements.currentPassword.value;
    const newPassword = elements.newPassword.value;
    const confirmPassword = elements.confirmPassword.value;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        showPasswordError('Пожалуйста, заполните все поля');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showPasswordError('Новые пароли не совпадают');
        return;
    }
    
    // В реальном приложении здесь был бы запрос к API
    showPasswordError('');
    elements.currentPassword.value = '';
    elements.newPassword.value = '';
    elements.confirmPassword.value = '';
    
    alert('Пароль успешно изменен');
}

// Показать ошибку при смене пароля
function showPasswordError(message) {
    elements.passwordError.textContent = message;
    elements.passwordError.classList.toggle('hidden', !message);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', init); 