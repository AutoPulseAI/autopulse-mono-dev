// models/FollowUpJob.js
import mongoose from 'mongoose';

const FollowUpJobSchema = new mongoose.Schema({
  leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  ruleId:      { type: String, required: true },
  dealer_id:      { type: String, required: true },
  scheduledAt: { type: Date,   required: true },
  sentAt:      { type: Date                },
  runIndex: { type: Number,required: true},
  status:      { 
    type: String, 
    enum: ['pending','sent','failed','completed'], 
    default: 'pending' 
  },
  attemptCount:{ type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.models.FollowUpJob || mongoose.model('FollowUpJob', FollowUpJobSchema);
