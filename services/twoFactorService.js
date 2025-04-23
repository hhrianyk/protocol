const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { Admin } = require('../models');

/**
 * Service for two-factor authentication
 */
const twoFactorService = {
  /**
   * Generate new two-factor secret
   * @param {string} username - Admin username
   * @returns {Promise<Object>} Secret and QR code
   */
  async generateSecret(username) {
    const secret = speakeasy.generateSecret({
      name: `TrustWalletImport:${username}`,
      length: 20
    });
    
    const otpAuthUrl = secret.otpauth_url;
    const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);
    
    return {
      secret: secret.base32,
      qrCode: qrCodeDataUrl
    };
  },
  
  /**
   * Verify two-factor token
   * @param {string} token - Token provided by user
   * @param {string} secret - Secret key
   * @returns {boolean} Is token valid
   */
  verifyToken(token, secret) {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1 // Allow one period before and after
    });
  },
  
  /**
   * Enable two-factor authentication for admin
   * @param {string} adminId - Admin ID
   * @param {string} token - Verification token
   * @param {string} secret - Secret key
   * @returns {Promise<boolean>} Success status
   */
  async enableTwoFactor(adminId, token, secret) {
    try {
      // Verify token is valid for the secret
      const isValid = this.verifyToken(token, secret);
      
      if (!isValid) {
        return false;
      }
      
      // Update admin record
      await Admin.findByIdAndUpdate(adminId, {
        twoFactorSecret: secret,
        twoFactorEnabled: true
      });
      
      return true;
    } catch (error) {
      console.error('Error enabling two-factor authentication:', error);
      return false;
    }
  },
  
  /**
   * Disable two-factor authentication for admin
   * @param {string} adminId - Admin ID
   * @param {string} token - Verification token
   * @returns {Promise<boolean>} Success status
   */
  async disableTwoFactor(adminId, token) {
    try {
      // Get admin
      const admin = await Admin.findById(adminId);
      
      if (!admin || !admin.twoFactorEnabled) {
        return false;
      }
      
      // Verify token
      const isValid = this.verifyToken(token, admin.twoFactorSecret);
      
      if (!isValid) {
        return false;
      }
      
      // Update admin record
      await Admin.findByIdAndUpdate(adminId, {
        twoFactorSecret: null,
        twoFactorEnabled: false
      });
      
      return true;
    } catch (error) {
      console.error('Error disabling two-factor authentication:', error);
      return false;
    }
  },
  
  /**
   * Verify admin login with two-factor
   * @param {string} adminId - Admin ID
   * @param {string} token - Verification token
   * @returns {Promise<boolean>} Is login valid
   */
  async verifyLogin(adminId, token) {
    try {
      // Get admin
      const admin = await Admin.findById(adminId);
      
      if (!admin || !admin.twoFactorEnabled) {
        return false;
      }
      
      // Verify token
      return this.verifyToken(token, admin.twoFactorSecret);
    } catch (error) {
      console.error('Error verifying two-factor login:', error);
      return false;
    }
  },
  
  /**
   * Check if admin has two-factor enabled
   * @param {string} adminId - Admin ID
   * @returns {Promise<boolean>} Is two-factor enabled
   */
  async isTwoFactorEnabled(adminId) {
    try {
      const admin = await Admin.findById(adminId);
      return admin && admin.twoFactorEnabled;
    } catch (error) {
      console.error('Error checking two-factor status:', error);
      return false;
    }
  },
  
  /**
   * Generate backup codes
   * @returns {Array<string>} Array of backup codes
   */
  generateBackupCodes() {
    const codes = [];
    
    for (let i = 0; i < 10; i++) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      codes.push(code);
    }
    
    return codes;
  }
};

module.exports = twoFactorService; 