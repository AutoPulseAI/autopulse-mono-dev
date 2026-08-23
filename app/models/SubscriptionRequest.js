// models/SubscriptionRequest.js
import mongoose from 'mongoose';

const subscriptionRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
 
  message: {
    type: String
  },
  phone: {
    type: String
  },
  email: {
    type: String
  },
  dealerCount: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: {
    type: Date
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  adminNotes: {
    type: String
  }
});

const SubscriptionRequest = mongoose.models.SubscriptionRequest || 
  mongoose.model('SubscriptionRequest', subscriptionRequestSchema);

export default SubscriptionRequest;