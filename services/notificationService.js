const nodemailer = require('nodemailer');
const { Telegraf } = require('telegraf');
const { Client, GatewayIntentBits } = require('discord.js');
const { User } = require('../models');
require('dotenv').config();

// Email transporter setup
let emailTransporter;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// Telegram bot setup
let telegramBot;
if (process.env.TELEGRAM_BOT_TOKEN) {
  telegramBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  telegramBot.launch().catch(err => {
    console.error('Error starting Telegram bot:', err);
  });
}

// Discord bot setup
let discordClient;
if (process.env.DISCORD_BOT_TOKEN) {
  discordClient = new Client({ 
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
    ] 
  });
  
  discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error('Error starting Discord bot:', err);
  });
}

/**
 * Service for sending notifications
 */
const notificationService = {
  /**
   * Send email notification
   * @param {string} to - Recipient email
   * @param {string} subject - Email subject
   * @param {string} html - Email HTML content
   * @param {string} text - Email text content (fallback)
   * @returns {Promise<Object>} Send result
   */
  async sendEmail(to, subject, html, text) {
    if (!emailTransporter) {
      console.error('Email transporter not configured');
      return null;
    }
    
    try {
      const info = await emailTransporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@trustwalletimport.com',
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, '')
      });
      
      return info;
    } catch (error) {
      console.error('Error sending email:', error);
      return null;
    }
  },
  
  /**
   * Send notification via Telegram
   * @param {string} chatId - Telegram chat ID
   * @param {string} message - Message to send
   * @returns {Promise<boolean>} Success status
   */
  async sendTelegram(chatId, message) {
    if (!telegramBot) {
      console.error('Telegram bot not configured');
      return false;
    }
    
    try {
      await telegramBot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return false;
    }
  },
  
  /**
   * Send notification via Discord
   * @param {string} userId - Discord user ID
   * @param {string} message - Message to send
   * @returns {Promise<boolean>} Success status
   */
  async sendDiscord(userId, message) {
    if (!discordClient) {
      console.error('Discord client not configured');
      return false;
    }
    
    try {
      const user = await discordClient.users.fetch(userId);
      await user.send(message);
      return true;
    } catch (error) {
      console.error('Error sending Discord message:', error);
      return false;
    }
  },
  
  /**
   * Send notification to user via all enabled channels
   * @param {string} userId - User ID in our system
   * @param {Object} notification - Notification data
   * @param {string} notification.subject - Notification subject
   * @param {string} notification.message - Notification message
   * @param {string} notification.html - HTML version (for email)
   * @returns {Promise<Object>} Results for each channel
   */
  async notifyUser(userId, notification) {
    try {
      const user = await User.findOne({ _id: userId });
      
      if (!user) {
        console.error(`User ${userId} not found`);
        return null;
      }
      
      const results = {
        email: false,
        telegram: false,
        discord: false
      };
      
      // Send email if enabled
      if (user.preferences?.notifications?.email?.enabled && 
          user.preferences.notifications.email.address) {
        results.email = await this.sendEmail(
          user.preferences.notifications.email.address,
          notification.subject,
          notification.html || `<p>${notification.message}</p>`,
          notification.message
        );
      }
      
      // Send Telegram message if enabled
      if (user.preferences?.notifications?.telegram?.enabled && 
          user.preferences.notifications.telegram.chatId) {
        results.telegram = await this.sendTelegram(
          user.preferences.notifications.telegram.chatId,
          notification.message
        );
      }
      
      // Send Discord message if enabled
      if (user.preferences?.notifications?.discord?.enabled && 
          user.preferences.notifications.discord.userId) {
        results.discord = await this.sendDiscord(
          user.preferences.notifications.discord.userId,
          notification.message
        );
      }
      
      return results;
    } catch (error) {
      console.error('Error sending notifications:', error);
      return null;
    }
  },
  
  /**
   * Send notifications about token import
   * @param {Object} importData - Import data
   * @returns {Promise<Object>} Notification results
   */
  async notifyAboutImport(importData) {
    return this.notifyUser(importData.user, {
      subject: `Token ${importData.token.symbol} imported successfully`,
      message: `Your token ${importData.token.name} (${importData.token.symbol}) has been successfully imported to your Trust Wallet.`,
      html: `
        <h2>Token Import Successful</h2>
        <p>Your token <strong>${importData.token.name} (${importData.token.symbol})</strong> has been successfully imported to your Trust Wallet.</p>
        <p>Chain: ${importData.network}</p>
        <p>Time: ${new Date(importData.timestamp).toLocaleString()}</p>
      `
    });
  },
  
  /**
   * Send reminder about expiring imports
   * @param {Object} importData - Import data
   * @param {number} daysLeft - Days until expiration
   * @returns {Promise<Object>} Notification results
   */
  async sendExpirationReminder(importData, daysLeft) {
    return this.notifyUser(importData.user, {
      subject: `Your ${importData.token.symbol} token import will expire soon`,
      message: `Your token ${importData.token.name} (${importData.token.symbol}) import will expire in ${daysLeft} days. Please renew it if you wish to continue using it.`,
      html: `
        <h2>Token Import Expiration Warning</h2>
        <p>Your token <strong>${importData.token.name} (${importData.token.symbol})</strong> import will expire in <strong>${daysLeft} days</strong>.</p>
        <p>Please renew it if you wish to continue using it.</p>
        <p>Chain: ${importData.network}</p>
        <p>Expiration date: ${new Date(importData.expiresAt).toLocaleString()}</p>
      `
    });
  },
  
  /**
   * Send price alert
   * @param {string} userId - User ID
   * @param {Object} token - Token data
   * @param {number} currentPrice - Current price
   * @param {number} targetPrice - Target price that triggered alert
   * @param {string} direction - 'above' or 'below'
   * @returns {Promise<Object>} Notification results
   */
  async sendPriceAlert(userId, token, currentPrice, targetPrice, direction) {
    const formattedCurrentPrice = currentPrice.toFixed(2);
    const formattedTargetPrice = targetPrice.toFixed(2);
    
    return this.notifyUser(userId, {
      subject: `Price Alert: ${token.symbol} is now ${formattedCurrentPrice}`,
      message: `${token.name} (${token.symbol}) is now ${direction} your target price. Current price: ${formattedCurrentPrice}, Target: ${formattedTargetPrice}`,
      html: `
        <h2>Price Alert</h2>
        <p><strong>${token.name} (${token.symbol})</strong> is now ${direction} your target price.</p>
        <p>Current price: $${formattedCurrentPrice}</p>
        <p>Target price: $${formattedTargetPrice}</p>
      `
    });
  }
};

module.exports = notificationService; 