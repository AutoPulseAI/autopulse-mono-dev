import mongoose from 'mongoose';

const demoRequestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  dealershipAgencyName: {
    type: String,
    required: [true, 'Dealership/Agency name is required'],
    enum: ['dealership', 'agency'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please use a valid email address'],
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^[+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  comment: {
    type: String,
    required: [true, 'Comment is required'],
    minlength: [10, 'Comment must be at least 10 characters long'],
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'contacted', 'scheduled', 'completed', 'rejected'],
    default: 'pending'
  },
  ipAddress: {
    type: String,
    trim: true
  },
  userAgent: {
    type: String,
    trim: true
  },
  source: {
    type: String,
    default: 'website'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Indexes
demoRequestSchema.index({ status: 1 });
demoRequestSchema.index({ email: 1 });
demoRequestSchema.index({ createdAt: -1 });

export const DemoRequest = mongoose.models.DemoRequest || mongoose.model('DemoRequest', demoRequestSchema);
  