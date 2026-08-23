// models/WebhookLog.js
import mongoose from 'mongoose';

const webhookLogSchema = new mongoose.Schema(
  {
    data: { type: mongoose.Schema.Types.Mixed, required: true }, // Raw webhook data
  },
  { timestamps: true } // Automatically add createdAt and updatedAt fields
);

const WebhookLog = mongoose.models.WebhookLog || mongoose.model('WebhookLog', webhookLogSchema);

export default WebhookLog;