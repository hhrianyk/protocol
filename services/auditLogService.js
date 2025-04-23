const { AuditLog } = require('../models');
const winston = require('winston');
const path = require('path');

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'trust-wallet-import' },
  transports: [
    // Write to all logs to console
    new winston.transports.Console(),
    // Write all logs to file
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/combined.log') 
    })
  ]
});

/**
 * Service for handling audit logging
 */
const auditLogService = {
  /**
   * Log activity to database and file
   * @param {Object} data - Log data
   * @param {string} data.action - Action description
   * @param {string} data.userId - User ID (optional)
   * @param {string} data.adminId - Admin ID (optional)
   * @param {string} data.ipAddress - IP address
   * @param {string} data.userAgent - User agent
   * @param {Object} data.details - Additional details
   * @param {string} data.severity - Log severity (info, warning, critical)
   * @returns {Promise<Object>} Created audit log
   */
  async log(data) {
    try {
      // Log to Winston
      const logLevel = data.severity === 'critical' 
        ? 'error' 
        : data.severity === 'warning' ? 'warn' : 'info';
        
      logger[logLevel]({
        action: data.action,
        userId: data.userId,
        adminId: data.adminId,
        ipAddress: data.ipAddress,
        timestamp: new Date().toISOString(),
        details: data.details
      });
      
      // Create log in database
      const auditLog = await AuditLog.create({
        action: data.action,
        userId: data.userId,
        adminId: data.adminId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        details: data.details,
        severity: data.severity || 'info'
      });
      
      return auditLog;
    } catch (error) {
      console.error('Error creating audit log:', error);
      
      // Even if we fail to save to database, still log to Winston
      logger.error({
        action: 'AUDIT_LOG_ERROR',
        message: 'Failed to save audit log to database',
        originalAction: data.action,
        error: error.message
      });
      
      return null;
    }
  },
  
  /**
   * Log user activity
   * @param {string} action - Action description
   * @param {string} userId - User ID
   * @param {Object} req - Express request object
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} Created audit log
   */
  async logUserActivity(action, userId, req, details = {}) {
    return this.log({
      action,
      userId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      details,
      severity: 'info'
    });
  },
  
  /**
   * Log admin activity
   * @param {string} action - Action description
   * @param {string} adminId - Admin ID
   * @param {Object} req - Express request object
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} Created audit log
   */
  async logAdminActivity(action, adminId, req, details = {}) {
    return this.log({
      action,
      adminId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      details,
      severity: 'info'
    });
  },
  
  /**
   * Log security event
   * @param {string} action - Action description
   * @param {Object} req - Express request object
   * @param {Object} details - Additional details
   * @param {string} severity - Log severity (warning, critical)
   * @returns {Promise<Object>} Created audit log
   */
  async logSecurityEvent(action, req, details = {}, severity = 'warning') {
    return this.log({
      action,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      details,
      severity
    });
  },
  
  /**
   * Get logs for specific user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Audit logs
   */
  async getUserLogs(userId, options = {}) {
    const query = { userId };
    
    if (options.startDate) {
      query.timestamp = { $gte: options.startDate };
    }
    
    if (options.endDate) {
      query.timestamp = { ...query.timestamp, $lte: options.endDate };
    }
    
    if (options.action) {
      query.action = options.action;
    }
    
    const limit = options.limit || 100;
    const skip = options.skip || 0;
    
    return AuditLog.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(skip);
  },
  
  /**
   * Get security logs
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Audit logs
   */
  async getSecurityLogs(options = {}) {
    const query = { 
      severity: { $in: options.severity || ['warning', 'critical'] }
    };
    
    if (options.startDate) {
      query.timestamp = { $gte: options.startDate };
    }
    
    if (options.endDate) {
      query.timestamp = { ...query.timestamp, $lte: options.endDate };
    }
    
    if (options.ipAddress) {
      query.ipAddress = options.ipAddress;
    }
    
    const limit = options.limit || 100;
    const skip = options.skip || 0;
    
    return AuditLog.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(skip);
  }
};

module.exports = auditLogService; 