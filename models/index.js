const mongoose = require('mongoose');
const mongooseEncryption = require('mongoose-encryption');
require('dotenv').config();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/trustwallet_import';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// Schemas
const userSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  firstSeen: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  importedTokens: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Token'
  }],
  preferences: {
    language: {
      type: String,
      default: 'en'
    },
    darkMode: {
      type: Boolean,
      default: false
    },
    notifications: {
      email: {
        enabled: { type: Boolean, default: false },
        address: { type: String }
      },
      telegram: {
        enabled: { type: Boolean, default: false },
        chatId: { type: String }
      },
      discord: {
        enabled: { type: Boolean, default: false },
        userId: { type: String }
      }
    }
  }
});

const tokenSchema = new mongoose.Schema({
  tokenId: {
    type: String,
    required: true,
    index: true
  },
  tokenAddress: {
    type: String
  },
  trcAddress: {
    type: String
  },
  name: {
    type: String
  },
  symbol: {
    type: String
  },
  decimals: {
    type: Number
  },
  tokenType: {
    type: String,
    enum: ['ERC20', 'TRC20', 'BEP20', 'SPL', 'AVAX', 'MATIC', 'OPTIMISM', 'ARBITRUM', 'NFT'],
    required: true
  },
  chain: {
    type: String,
    enum: ['Ethereum', 'Tron', 'BSC', 'Solana', 'Avalanche', 'Polygon', 'Optimism', 'Arbitrum'],
    required: true
  },
  logoUrl: {
    type: String
  },
  contractVerified: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const linkSchema = new mongoose.Schema({
  linkId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  url: {
    type: String,
    required: true
  },
  qrCode: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'expired'],
    default: 'pending'
  },
  userAddress: {
    type: String
  },
  tokens: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Token'
  }],
  createdBy: {
    type: String
  },
  network: {
    type: String,
    enum: ['Ethereum', 'Tron', 'BSC', 'Solana', 'Avalanche', 'Polygon', 'Optimism', 'Arbitrum'],
    default: 'Ethereum'
  },
  accessCount: {
    type: Number,
    default: 0
  }
});

const importSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  token: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Token',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'revoked'],
    default: 'active'
  },
  transactionHash: {
    type: String
  },
  importSignature: {
    type: String
  },
  network: {
    type: String,
    enum: ['Ethereum', 'Tron', 'BSC', 'Solana', 'Avalanche', 'Polygon', 'Optimism', 'Arbitrum'],
    required: true
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
});

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'moderator', 'viewer'],
    default: 'admin'
  },
  twoFactorSecret: {
    type: String
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  locked: {
    type: Boolean,
    default: false
  },
  permissions: {
    createLinks: { type: Boolean, default: true },
    manageUsers: { type: Boolean, default: true },
    viewReports: { type: Boolean, default: true },
    manageSettings: { type: Boolean, default: true }
  }
});

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  userId: {
    type: String
  },
  adminId: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info'
  }
});

// Add encryption to sensitive fields
const encKey = process.env.DB_ENCRYPTION_KEY;
if (encKey) {
  const sensitiveFields = ['twoFactorSecret'];
  adminSchema.plugin(mongooseEncryption, { 
    secret: encKey,
    encryptedFields: sensitiveFields
  });
}

// Create models
const User = mongoose.model('User', userSchema);
const Token = mongoose.model('Token', tokenSchema);
const Link = mongoose.model('Link', linkSchema);
const Import = mongoose.model('Import', importSchema);
const Admin = mongoose.model('Admin', adminSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = {
  User,
  Token,
  Link,
  Import,
  Admin,
  AuditLog
}; 