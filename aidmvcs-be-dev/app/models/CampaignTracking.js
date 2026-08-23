import mongoose from "mongoose";

/**
 * CampaignTracking Model
 * Tracks individual interactions with campaign messages (opens, clicks, unsubscribes)
 */
const CampaignTrackingSchema = new mongoose.Schema(
  {
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true
    },
    campaign_lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CampaignLead",
      required: true,
      index: true
    },
    lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true
    },
    dealer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    // Contact information
    email: {
      type: String,
      default: "",
      trim: true,
      index: true
    },
    phone: {
      type: String,
      default: "",
      trim: true,
      index: true
    },
    // Tracking type
    event_type: {
      type: String,
      enum: ["open", "click", "unsubscribe", "bounce"],
      required: true,
      index: true
    },
    // For click events - what was clicked
    clicked_url: {
      type: String,
      default: null
    },
    // Tracking metadata
    ip_address: {
      type: String,
      default: null
    },
    user_agent: {
      type: String,
      default: null
    },
    is_bot: {
      type: Boolean,
      default: false
    },
    // Timestamps
    event_timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
CampaignTrackingSchema.index({ campaign_id: 1, event_type: 1 });
CampaignTrackingSchema.index({ campaign_id: 1, email: 1 });
CampaignTrackingSchema.index({ campaign_id: 1, phone: 1 });
CampaignTrackingSchema.index({ campaign_lead_id: 1, event_type: 1 });
CampaignTrackingSchema.index({ dealer_id: 1, event_timestamp: -1 });

// Unique constraint to prevent duplicate tracking of same event
// (but allow multiple opens/clicks from same lead)
CampaignTrackingSchema.index(
  { campaign_lead_id: 1, event_type: 1, event_timestamp: 1 },
  { unique: false }
);

export default mongoose.models.CampaignTracking || 
  mongoose.model("CampaignTracking", CampaignTrackingSchema);
