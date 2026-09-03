// models/CSVImportedData.js
import mongoose from 'mongoose';

const csvImportedDataSchema = new mongoose.Schema({
  // Reference to the CSV file
  csv_import_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CSVImportData',
    required: true
  },
  
  // Record information
  record_index: {
    type: Number,
    required: true
  },
  
  // Source data from CSV
  source_data: {
    type: Object,
    required: true
  },
  
  // Import status
  import_status: {
    type: String,
    enum: ['imported', 'skipped', 'failed'],
    default: 'imported',
    required: true
  },
  
  // Error information (if failed)
  error_message: {
    type: String,
    default: null
  },
  
  // Processing metadata
  processed_at: {
    type: Date,
    default: Date.now
  },
  
  // Validation results
  validation_errors: [{
    field: String,
    message: String,
    value: String
  }],
  
  // Additional metadata
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for better query performance
csvImportedDataSchema.index({ csv_import_id: 1 });
csvImportedDataSchema.index({ import_status: 1 });
csvImportedDataSchema.index({ record_index: 1 });
csvImportedDataSchema.index({ processed_at: -1 });
csvImportedDataSchema.index({ csv_import_id: 1, record_index: 1 });

// Static method to get imported data by CSV import ID
csvImportedDataSchema.statics.getByCsvImportId = function(csvImportId, options = {}) {
  const { 
    status = null, 
    limit = null, 
    skip = 0,
    sort = { record_index: 1 }
  } = options;
  
  const query = { csv_import_id: csvImportId };
  
  if (status) {
    query.import_status = status;
  }
  
  let queryBuilder = this.find(query).sort(sort).skip(skip);
  
  if (limit) {
    queryBuilder = queryBuilder.limit(limit);
  }
  
  return queryBuilder;
};

// Static method to get statistics by CSV import ID
csvImportedDataSchema.statics.getStatsByCsvImportId = function(csvImportId) {
  return this.aggregate([
    { $match: { csv_import_id: csvImportId } },
    {
      $group: {
        _id: '$import_status',
        count: { $sum: 1 }
      }
    }
  ]);
};

// Static method to get all imported data with CSV info
csvImportedDataSchema.statics.getWithCsvInfo = function(csvImportId, options = {}) {
  const { 
    status = null, 
    limit = null, 
    skip = 0,
    sort = { record_index: 1 }
  } = options;
  
  const matchStage = { csv_import_id: csvImportId };
  
  if (status) {
    matchStage.import_status = status;
  }
  
  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'csvimportdatas',
        localField: 'csv_import_id',
        foreignField: '_id',
        as: 'csv_import_info'
      }
    },
    {
      $unwind: '$csv_import_info'
    },
    {
      $sort: sort
    }
  ];
  
  if (skip > 0) {
    pipeline.push({ $skip: skip });
  }
  
  if (limit) {
    pipeline.push({ $limit: limit });
  }
  
  return this.aggregate(pipeline);
};

// Method to add validation error
csvImportedDataSchema.methods.addValidationError = function(field, message, value = null) {
  this.validation_errors.push({
    field,
    message,
    value: value ? String(value) : null
  });
  return this.save();
};

// Method to update import status
csvImportedDataSchema.methods.updateStatus = function(status, errorMessage = null) {
  this.import_status = status;
  if (errorMessage) {
    this.error_message = errorMessage;
  }
  return this.save();
};

export default mongoose.models.CSVImportedData || mongoose.model('CSVImportedData', csvImportedDataSchema);
