// models/CSVImportData.js
import mongoose from 'mongoose';

const csvImportDataSchema = new mongoose.Schema({
  // File information
  original_filename: {
    type: String,
    required: true
  },
  file_type: {
    type: String,
    enum: ['zip', 'csv'],
    required: true
  },
  file_size: {
    type: Number,
    required: true
  },
  file_path: {
    type: String,
    required: true
  },
  
  // Processing information
  processing_status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  processing_started_at: {
    type: Date
  },
  processing_completed_at: {
    type: Date
  },
  
  // Results
  total_records: {
    type: Number,
    default: 0
  },
  records_imported: {
    type: Number,
    default: 0
  },
  records_skipped: {
    type: Number,
    default: 0
  },
  records_failed: {
    type: Number,
    default: 0
  },
  
  // For zip files
  extracted_files: [{
    filename: String,
    records_count: Number,
    imported_count: Number,
    skipped_count: Number,
    failed_count: Number,
    csv_data_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CSVImportData'
    }
  }],
  
  // Error handling
  error_message: {
    type: String
  },
  error_details: {
    type: String
  },
  
  // File locations
  processed_file_path: {
    type: String
  },
  failed_file_path: {
    type: String
  },
  
  // Metadata
  dealer_id: {
    type: String, // Changed to String instead of ObjectId reference
    default: null
  },
  dealer_name: {
    type: String,
    default: null
  },
  dealer_email: {
    type: String,
    default: null
  },
  import_source: {
    type: String,
    default: 'csv_cron_service'
  },
  parent_zip_file: {
    type: String,
    default: null
  },
  
  // Processing logs
  processing_logs: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    level: {
      type: String,
      enum: ['info', 'warning', 'error'],
      default: 'info'
    },
    message: String,
    details: String
  }],
  
  // CSV structure analysis
  csv_structure: {
    headers: [String],
    total_columns: Number,
    sample_data: [Object],
    detected_format: String
  },
  
  // Note: imported_data is now stored in separate CSVImportedData model
}, {
  timestamps: true
});

// Indexes for better query performance
csvImportDataSchema.index({ processing_status: 1 });
csvImportDataSchema.index({ dealer_id: 1 });
csvImportDataSchema.index({ created_at: -1 });
csvImportDataSchema.index({ parent_zip_file: 1 });
csvImportDataSchema.index({ import_source: 1 });

// Method to add processing log
csvImportDataSchema.methods.addLog = function(level, message, details = null) {
  this.processing_logs.push({
    level,
    message,
    details: details ? JSON.stringify(details) : null
  });
  return this.save();
};

// Method to update processing status
csvImportDataSchema.methods.updateStatus = function(status, additionalData = {}) {
  this.processing_status = status;
  
  if (status === 'processing' && !this.processing_started_at) {
    this.processing_started_at = new Date();
  } else if (status === 'completed' || status === 'failed') {
    this.processing_completed_at = new Date();
  }
  
  // Update additional data
  Object.assign(this, additionalData);
  
  return this.save();
};

// Method to get imported data (from separate model)
csvImportDataSchema.methods.getImportedData = function(options = {}) {
  const CSVImportedData = mongoose.model('CSVImportedData');
  return CSVImportedData.getByCsvImportId(this._id, options);
};

// Method to get imported data statistics
csvImportDataSchema.methods.getImportedDataStats = function() {
  const CSVImportedData = mongoose.model('CSVImportedData');
  return CSVImportedData.getStatsByCsvImportId(this._id);
};

// Static method to get processing statistics
csvImportDataSchema.statics.getProcessingStats = function(dealerId = null, dateRange = null) {
  const match = {};
  
  if (dealerId) {
    match.dealer_id = dealerId;
  }
  
  if (dateRange) {
    match.created_at = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$processing_status',
        count: { $sum: 1 },
        total_records: { $sum: '$total_records' },
        records_imported: { $sum: '$records_imported' },
        records_skipped: { $sum: '$records_skipped' },
        records_failed: { $sum: '$records_failed' }
      }
    }
  ]);
};

// Static method to get recent processing history
csvImportDataSchema.statics.getRecentHistory = function(limit = 50, dealerId = null) {
  const match = {};
  
  if (dealerId) {
    match.dealer_id = dealerId;
  }
  
  return this.find(match)
    .sort({ created_at: -1 })
    .limit(limit)
    .select('original_filename file_type processing_status total_records records_imported created_at dealer_name');
};

// Method to update counts from separate imported data model
csvImportDataSchema.methods.updateCountsFromImportedData = async function() {
  const CSVImportedData = mongoose.model('CSVImportedData');
  const stats = await CSVImportedData.getStatsByCsvImportId(this._id);
  
  // Reset counts
  this.records_imported = 0;
  this.records_skipped = 0;
  this.records_failed = 0;
  this.total_records = 0;
  
  // Update counts from stats
  stats.forEach(stat => {
    switch (stat._id) {
      case 'imported':
        this.records_imported = stat.count;
        break;
      case 'skipped':
        this.records_skipped = stat.count;
        break;
      case 'failed':
        this.records_failed = stat.count;
        break;
    }
  });
  
  this.total_records = this.records_imported + this.records_skipped + this.records_failed;
  
  return this.save();
};

export default mongoose.models.CSVImportData || mongoose.model('CSVImportData', csvImportDataSchema);
