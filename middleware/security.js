const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const csurf = require('csurf');
const auditLogService = require('../services/auditLogService');

// Suspicious IP addresses (could be loaded from database)
const suspiciousIPs = new Set();

// Banned IP addresses (could be loaded from database)
const bannedIPs = new Set();

// Configure rate limiting
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes by default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    auditLogService.logSecurityEvent(
      'RATE_LIMIT_EXCEEDED',
      req,
      { path: req.path },
      'warning'
    );
    
    res.status(options.statusCode).json({
      success: false,
      message: 'Too many requests, please try again later.'
    });
  }
});

// More strict limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 5, // Start blocking after 5 failed attempts
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    auditLogService.logSecurityEvent(
      'AUTH_RATE_LIMIT_EXCEEDED',
      req,
      { path: req.path },
      'critical'
    );
    
    res.status(options.statusCode).json({
      success: false,
      message: 'Too many login attempts, please try again later.'
    });
  }
});

// Configure CSRF protection
const csrfProtection = csurf({ 
  cookie: { 
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', 
    sameSite: 'strict'
  } 
});

/**
 * IP filtering middleware
 */
const ipFilter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  // Check if IP is banned
  if (bannedIPs.has(ip)) {
    auditLogService.logSecurityEvent(
      'BANNED_IP_ACCESS_ATTEMPT',
      req,
      { ip },
      'critical'
    );
    
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }
  
  // Check if IP is suspicious
  if (suspiciousIPs.has(ip)) {
    auditLogService.logSecurityEvent(
      'SUSPICIOUS_IP_ACCESS',
      req,
      { ip, path: req.path },
      'warning'
    );
  }
  
  next();
};

/**
 * Security headers middleware using helmet with custom configuration
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'cdnjs.cloudflare.com', 'trustwallet.com', 'cryptologos.cc'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com'],
      connectSrc: ["'self'", 'api.trongrid.io', 'mainnet.infura.io', 'bsc-dataseed.binance.org'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  xssFilter: true,
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  dnsPrefetchControl: {
    allow: false
  },
  referrerPolicy: {
    policy: 'same-origin'
  }
});

/**
 * Session validation middleware
 */
const validateSession = (req, res, next) => {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({
      success: false,
      message: 'Invalid session'
    });
  }
  
  // Check if session is expired
  if (req.session.expiresAt && req.session.expiresAt < Date.now()) {
    auditLogService.logSecurityEvent(
      'EXPIRED_SESSION_ACCESS_ATTEMPT',
      req,
      { adminId: req.session.adminId },
      'warning'
    );
    
    return res.status(401).json({
      success: false,
      message: 'Session expired'
    });
  }
  
  next();
};

/**
 * Detect suspicious activity
 */
const detectSuspiciousActivity = (req, res, next) => {
  // Check for suspicious headers
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  
  const suspiciousFlags = [];
  
  // No user agent or very short
  if (!userAgent || userAgent.length < 10) {
    suspiciousFlags.push('missing_or_short_user_agent');
  }
  
  // Known bot or scanner patterns in user agent
  if (/bot|crawler|spider|scan/i.test(userAgent)) {
    suspiciousFlags.push('bot_user_agent');
  }
  
  // No accept-language header
  if (!acceptLanguage) {
    suspiciousFlags.push('missing_accept_language');
  }
  
  // Unusual request method for path
  if ((req.path.includes('/api/') && req.method === 'TRACE') || 
      (req.path.includes('/api/') && req.method === 'OPTIONS')) {
    suspiciousFlags.push('unusual_http_method');
  }
  
  // If suspicious flags were raised, log it
  if (suspiciousFlags.length > 0) {
    auditLogService.logSecurityEvent(
      'SUSPICIOUS_REQUEST_DETECTED',
      req,
      { 
        flags: suspiciousFlags,
        userAgent,
        path: req.path,
        method: req.method
      },
      'warning'
    );
    
    // Add IP to suspicious list if multiple flags
    if (suspiciousFlags.length >= 2) {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      suspiciousIPs.add(ip);
    }
  }
  
  next();
};

// Export middleware
module.exports = {
  apiLimiter,
  authLimiter,
  csrfProtection,
  ipFilter,
  securityHeaders,
  validateSession,
  detectSuspiciousActivity,
  bannedIPs,
  suspiciousIPs
}; 