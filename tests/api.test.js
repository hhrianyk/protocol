const request = require('supertest');
const { expect } = require('chai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Мокаем зависимости
jest.mock('jsonwebtoken');
jest.mock('bcrypt');
jest.mock('fs');
jest.mock('web3');
jest.mock('socket.io');

// Импортируем сервер
const app = require('../server');

describe('API Tests', () => {
  let token;
  let adminToken;
  
  beforeAll(() => {
    // Мокаем функцию jwt.sign
    jwt.sign.mockImplementation((payload, secret, options) => {
      if (payload.userId) {
        return 'user-jwt-token';
      } else if (payload.adminId) {
        return 'admin-jwt-token';
      }
      return 'jwt-token';
    });
    
    // Мокаем функцию bcrypt.compareSync
    bcrypt.compareSync.mockImplementation((password, hash) => {
      return password === 'admin123';
    });
    
    token = 'user-jwt-token';
    adminToken = 'admin-jwt-token';
  });
  
  describe('Health Check', () => {
    it('Должен возвращать статус 200 и сообщение о работе сервера', async () => {
      const response = await request(app).get('/api/health');
      
      expect(response.status).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.message).to.equal('Сервер работает');
      expect(response.body).to.have.property('timestamp');
    });
  });
  
  describe('Сессии пользователя', () => {
    it('Должен создавать новую сессию пользователя', async () => {
      const response = await request(app)
        .post('/api/session');
      
      expect(response.status).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.data).to.have.property('sessionId');
      expect(response.body.data).to.have.property('userId');
      expect(response.body.data).to.have.property('token');
    });
  });
  
  describe('Генерация ссылок', () => {
    it('Должен генерировать новую ссылку для импорта токена', async () => {
      const response = await request(app)
        .post('/api/generate-link');
      
      expect(response.status).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.data).to.have.property('linkId');
      expect(response.body.data).to.have.property('url');
      expect(response.body.data).to.have.property('qrCode');
      expect(response.body.data).to.have.property('expiresAt');
    });
  });
  
  describe('Получение информации о ссылке', () => {
    let linkId;
    
    beforeAll(async () => {
      // Создаем ссылку для теста
      const response = await request(app)
        .post('/api/generate-link');
      
      linkId = response.body.data.linkId;
    });
    
    it('Должен возвращать информацию о существующей ссылке', async () => {
      const response = await request(app)
        .get(`/api/link/${linkId}`);
      
      expect(response.status).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.data.linkId).to.equal(linkId);
      expect(response.body.data).to.have.property('status');
      expect(response.body.data).to.have.property('createdAt');
      expect(response.body.data).to.have.property('expiresAt');
    });
    
    it('Должен возвращать 404 для несуществующей ссылки', async () => {
      const response = await request(app)
        .get('/api/link/non-existing-id');
      
      expect(response.status).to.equal(404);
      expect(response.body.success).to.be.false;
      expect(response.body.message).to.equal('Ссылка не найдена');
    });
  });
  
  describe('Авторизация администратора', () => {
    it('Должен авторизовать администратора с правильными учетными данными', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({
          username: 'admin',
          password: 'admin123'
        });
      
      expect(response.status).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.data).to.have.property('adminId');
      expect(response.body.data).to.have.property('username');
      expect(response.body.data).to.have.property('token');
    });
    
    it('Должен отклонить авторизацию с неправильными учетными данными', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({
          username: 'admin',
          password: 'wrong_password'
        });
      
      expect(response.status).to.equal(401);
      expect(response.body.success).to.be.false;
      expect(response.body.message).to.equal('Неверное имя пользователя или пароль');
    });
  });
  
  describe('API администратора (защищенное)', () => {
    it('Должен отклонять запросы без авторизации', async () => {
      const response = await request(app)
        .get('/api/admin/links');
      
      expect(response.status).to.equal(401);
      expect(response.body.success).to.be.false;
      expect(response.body.message).to.equal('Токен не предоставлен');
    });
    
    it('Должен возвращать список ссылок для авторизованного администратора', async () => {
      const response = await request(app)
        .get('/api/admin/links')
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(response.status).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(Array.isArray(response.body.data)).to.be.true;
    });
    
    it('Должен возвращать статистику для авторизованного администратора', async () => {
      const response = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(response.status).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.data).to.have.property('totalLinks');
      expect(response.body.data).to.have.property('pendingLinks');
      expect(response.body.data).to.have.property('completedLinks');
      expect(response.body.data).to.have.property('expiredLinks');
    });
  });
  
  describe('Обработка ошибок', () => {
    it('Должен возвращать 404 для несуществующих маршрутов API', async () => {
      const response = await request(app)
        .get('/api/non-existing-route');
      
      expect(response.status).to.equal(404);
    });
    
    it('Должен возвращать 401 при неверном токене', async () => {
      const response = await request(app)
        .get('/api/admin/links')
        .set('Authorization', 'Bearer invalid-token');
      
      expect(response.status).to.equal(401);
      expect(response.body.success).to.be.false;
      expect(response.body.message).to.equal('Недействительный токен');
    });
  });
  
  describe('SPA маршруты', () => {
    it('Должен возвращать index.html для любого маршрута не API', async () => {
      const response = await request(app)
        .get('/some/random/path');
      
      expect(response.status).to.equal(200);
      expect(response.type).to.equal('text/html');
    });
  });
});

// Тесты для второго приложения (админ-панель)
const adminApp = require('../server').adminApp;

describe('Admin App Tests', () => {
  it('Должен возвращать index.html для любого маршрута админ-панели', async () => {
    const response = await request(adminApp)
      .get('/some/random/admin/path');
    
    expect(response.status).to.equal(200);
    expect(response.type).to.equal('text/html');
  });
}); 