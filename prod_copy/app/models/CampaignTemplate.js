import mongoose from "mongoose";

const CampaignTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    message_type: {
      type: String,
      enum: ["email", "sms"],
      required: true,
      default: "email"
    },
    dealer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    subject: {
      type: String,
      default: ""
    },
    body: {
      type: String,
      default: ""
    },
    is_default: {
      type: Boolean,
      default: false
    },
    category: {
      type: String,
      trim: true,
      default: "General"
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries
CampaignTemplateSchema.index({ dealer_id: 1, createdAt: -1 });
CampaignTemplateSchema.index({ dealer_id: 1, message_type: 1 });
CampaignTemplateSchema.index({ dealer_id: 1, category: 1 });

export default mongoose.models.CampaignTemplate || mongoose.model("CampaignTemplate", CampaignTemplateSchema);

