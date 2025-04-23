const { Import, User, Token, Link, AuditLog } = require('../models');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Controller for analytics functions
 */
const analyticsController = {
  /**
   * Get dashboard analytics data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDashboardData(req, res) {
    try {
      // Get date range from query params or default to last 30 days
      const endDate = new Date();
      const startDate = req.query.startDate 
        ? new Date(req.query.startDate) 
        : new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
      
      // Total users
      const totalUsers = await User.countDocuments();
      
      // New users in period
      const newUsers = await User.countDocuments({
        firstSeen: { $gte: startDate, $lte: endDate }
      });
      
      // Total imports
      const totalImports = await Import.countDocuments();
      
      // Imports in period
      const periodImports = await Import.countDocuments({
        timestamp: { $gte: startDate, $lte: endDate }
      });
      
      // Total tokens
      const totalTokens = await Token.countDocuments();
      
      // Active imports (not expired or revoked)
      const activeImports = await Import.countDocuments({
        status: 'active'
      });
      
      // Imports by chain
      const importsByChain = await Import.aggregate([
        { $group: { _id: '$network', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      
      // Imports by token type
      const importsByTokenType = await Import.aggregate([
        {
          $lookup: {
            from: 'tokens',
            localField: 'token',
            foreignField: '_id',
            as: 'tokenData'
          }
        },
        { $unwind: '$tokenData' },
        { $group: { _id: '$tokenData.tokenType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      
      // Daily imports over time period
      const dailyImports = await Import.aggregate([
        { 
          $match: { 
            timestamp: { $gte: startDate, $lte: endDate } 
          } 
        },
        {
          $group: {
            _id: { 
              $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } 
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      
      // Most popular tokens
      const popularTokens = await Import.aggregate([
        {
          $lookup: {
            from: 'tokens',
            localField: 'token',
            foreignField: '_id',
            as: 'tokenData'
          }
        },
        { $unwind: '$tokenData' },
        { $group: { 
          _id: '$token', 
          count: { $sum: 1 },
          name: { $first: '$tokenData.name' },
          symbol: { $first: '$tokenData.symbol' },
          tokenType: { $first: '$tokenData.tokenType' }
        }},
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);
      
      // Return all data
      res.json({
        success: true,
        data: {
          users: {
            total: totalUsers,
            new: newUsers
          },
          imports: {
            total: totalImports,
            period: periodImports,
            active: activeImports,
            byChain: importsByChain,
            byTokenType: importsByTokenType,
            daily: dailyImports
          },
          tokens: {
            total: totalTokens,
            popular: popularTokens
          },
          period: {
            startDate,
            endDate
          }
        }
      });
    } catch (error) {
      console.error('Error getting analytics data:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching analytics data'
      });
    }
  },
  
  /**
   * Generate and download CSV report
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async generateCSVReport(req, res) {
    try {
      const { reportType, startDate, endDate } = req.body;
      
      if (!reportType) {
        return res.status(400).json({
          success: false,
          message: 'Report type is required'
        });
      }
      
      // Date range
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();
      
      let data;
      let fileName;
      let headers;
      
      switch (reportType) {
        case 'imports':
          data = await Import.find({
            timestamp: { $gte: start, $lte: end }
          })
          .populate('user', 'address')
          .populate('token', 'name symbol tokenType')
          .lean();
          
          fileName = 'import_report.csv';
          headers = 'User,Token Name,Token Symbol,Token Type,Network,Status,Import Date\n';
          
          data = data.map(item => {
            return `${item.user.address},${item.token.name},${item.token.symbol},${item.token.tokenType},${item.network},${item.status},${new Date(item.timestamp).toISOString()}`;
          }).join('\n');
          
          break;
          
        case 'users':
          data = await User.find({
            firstSeen: { $gte: start, $lte: end }
          }).lean();
          
          fileName = 'user_report.csv';
          headers = 'User Address,First Seen,Last Active,Imported Tokens Count\n';
          
          data = data.map(item => {
            return `${item.address},${new Date(item.firstSeen).toISOString()},${new Date(item.lastActive).toISOString()},${item.importedTokens.length}`;
          }).join('\n');
          
          break;
          
        case 'security':
          data = await AuditLog.find({
            timestamp: { $gte: start, $lte: end },
            severity: { $in: ['warning', 'critical'] }
          }).lean();
          
          fileName = 'security_report.csv';
          headers = 'Timestamp,Action,Severity,IP Address,User ID,Admin ID\n';
          
          data = data.map(item => {
            return `${new Date(item.timestamp).toISOString()},${item.action},${item.severity},${item.ipAddress},${item.userId || ''},${item.adminId || ''}`;
          }).join('\n');
          
          break;
          
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid report type'
          });
      }
      
      // Set headers for download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
      
      // Send CSV data
      res.send(headers + data);
      
    } catch (error) {
      console.error('Error generating CSV report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating report'
      });
    }
  },
  
  /**
   * Generate and download PDF report
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async generatePDFReport(req, res) {
    try {
      const { reportType, startDate, endDate } = req.body;
      
      if (!reportType) {
        return res.status(400).json({
          success: false,
          message: 'Report type is required'
        });
      }
      
      // Date range
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();
      
      // Create a new PDF document
      const doc = new PDFDocument();
      const tempFilePath = path.join(os.tmpdir(), `report-${Date.now()}.pdf`);
      const stream = fs.createWriteStream(tempFilePath);
      
      doc.pipe(stream);
      
      // Add report title
      doc.fontSize(25)
         .text('Trust Wallet Token Import', { align: 'center' })
         .moveDown();
      
      // Add report subtitle
      let reportTitle;
      switch (reportType) {
        case 'imports':
          reportTitle = 'Token Import Report';
          break;
        case 'users':
          reportTitle = 'User Activity Report';
          break;
        case 'security':
          reportTitle = 'Security Incidents Report';
          break;
        default:
          reportTitle = 'Analytics Report';
      }
      
      doc.fontSize(18)
         .text(reportTitle, { align: 'center' })
         .moveDown();
      
      // Add date range
      doc.fontSize(12)
         .text(`Period: ${start.toLocaleDateString()} to ${end.toLocaleDateString()}`, { align: 'center' })
         .moveDown()
         .moveDown();
      
      // Add report data based on type
      switch (reportType) {
        case 'imports':
          // Add imports statistics
          const totalImports = await Import.countDocuments({
            timestamp: { $gte: start, $lte: end }
          });
          
          const activeImports = await Import.countDocuments({
            timestamp: { $gte: start, $lte: end },
            status: 'active'
          });
          
          const byChain = await Import.aggregate([
            { 
              $match: { timestamp: { $gte: start, $lte: end } } 
            },
            { $group: { _id: '$network', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ]);
          
          doc.fontSize(14)
             .text('Import Statistics', { underline: true })
             .moveDown();
          
          doc.fontSize(12)
             .text(`Total Imports: ${totalImports}`)
             .text(`Active Imports: ${activeImports}`)
             .moveDown();
          
          doc.text('Imports by Blockchain:', { underline: true })
             .moveDown();
          
          byChain.forEach(item => {
            doc.text(`${item._id}: ${item.count}`);
          });
          
          doc.moveDown()
             .moveDown();
          
          // Top imported tokens
          const topTokens = await Import.aggregate([
            { 
              $match: { timestamp: { $gte: start, $lte: end } } 
            },
            {
              $lookup: {
                from: 'tokens',
                localField: 'token',
                foreignField: '_id',
                as: 'tokenData'
              }
            },
            { $unwind: '$tokenData' },
            { $group: { 
              _id: '$token', 
              count: { $sum: 1 },
              name: { $first: '$tokenData.name' },
              symbol: { $first: '$tokenData.symbol' }
            }},
            { $sort: { count: -1 } },
            { $limit: 5 }
          ]);
          
          doc.fontSize(14)
             .text('Top Imported Tokens', { underline: true })
             .moveDown();
          
          topTokens.forEach(token => {
            doc.fontSize(12)
               .text(`${token.name} (${token.symbol}): ${token.count} imports`);
          });
          
          break;
          
        case 'users':
          // Add user statistics
          const totalUsers = await User.countDocuments({
            firstSeen: { $gte: start, $lte: end }
          });
          
          const activeUsers = await User.countDocuments({
            lastActive: { $gte: start, $lte: end }
          });
          
          const usersWithImports = await User.countDocuments({
            firstSeen: { $gte: start, $lte: end },
            importedTokens: { $ne: [] }
          });
          
          doc.fontSize(14)
             .text('User Statistics', { underline: true })
             .moveDown();
          
          doc.fontSize(12)
             .text(`New Users: ${totalUsers}`)
             .text(`Active Users: ${activeUsers}`)
             .text(`Users with Imports: ${usersWithImports}`)
             .text(`Import Rate: ${Math.round((usersWithImports / totalUsers) * 100)}%`)
             .moveDown()
             .moveDown();
          
          // Most active users
          const mostActiveUsers = await Import.aggregate([
            { 
              $match: { timestamp: { $gte: start, $lte: end } } 
            },
            { $group: { 
              _id: '$user', 
              count: { $sum: 1 } 
            }},
            {
              $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'userData'
              }
            },
            { $unwind: '$userData' },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ]);
          
          doc.fontSize(14)
             .text('Most Active Users', { underline: true })
             .moveDown();
          
          mostActiveUsers.forEach(user => {
            doc.fontSize(12)
               .text(`${user.userData.address.substring(0, 8)}...${user.userData.address.substring(36)}: ${user.count} imports`);
          });
          
          break;
          
        case 'security':
          // Add security statistics
          const totalEvents = await AuditLog.countDocuments({
            timestamp: { $gte: start, $lte: end },
            severity: { $in: ['warning', 'critical'] }
          });
          
          const criticalEvents = await AuditLog.countDocuments({
            timestamp: { $gte: start, $lte: end },
            severity: 'critical'
          });
          
          const commonActions = await AuditLog.aggregate([
            { 
              $match: { 
                timestamp: { $gte: start, $lte: end },
                severity: { $in: ['warning', 'critical'] }
              } 
            },
            { $group: { _id: '$action', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
          ]);
          
          doc.fontSize(14)
             .text('Security Statistics', { underline: true })
             .moveDown();
          
          doc.fontSize(12)
             .text(`Total Security Events: ${totalEvents}`)
             .text(`Critical Events: ${criticalEvents}`)
             .moveDown();
          
          doc.text('Most Common Security Events:', { underline: true })
             .moveDown();
          
          commonActions.forEach(item => {
            doc.text(`${item._id}: ${item.count}`);
          });
          
          break;
      }
      
      // Add footer with generation time
      doc.moveDown()
         .moveDown()
         .fontSize(10)
         .text(`Report generated on ${new Date().toLocaleString()}`, { align: 'center' });
      
      // Finalize document
      doc.end();
      
      // Wait for the PDF to be written
      stream.on('finish', () => {
        // Read the file
        const fileContent = fs.readFileSync(tempFilePath);
        
        // Set headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=report-${reportType}.pdf`);
        
        // Send the file
        res.send(fileContent);
        
        // Delete temp file
        fs.unlinkSync(tempFilePath);
      });
      
    } catch (error) {
      console.error('Error generating PDF report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating report'
      });
    }
  }
};

module.exports = analyticsController; 