import mongoose from "mongoose";

const CampaignLeadSchema = new mongoose.Schema(
  {
    campaign_id: {
      type: String,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      default: "",
      trim: true
    },
    phone: {
      type: String,
      default: "",
      trim: true
    },
    lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null
    },
    dealer_id: {
      type: String,
      required: true,
    },
    // Status tracking for campaign execution
    status: {
      type: String,
      // held / blocked: the send check (agentic-upsell MASTER_PLAN_3 decision 66)
      enum: ["pending", "held", "blocked", "sent", "delivered", "failed", "bounced"],
      default: "pending"
    },
    // When a held text may go out (customer's hours, dealer hours, frequency cap)
    held_until: {
      type: Date,
      default: null
    },
    // Why the send check held or blocked the text
    block_reason: {
      type: String,
      default: null
    },
    sent_at: {
      type: Date,
      default: null
    },
    delivered_at: {
      type: Date,
      default: null
    },
    error_message: {
      type: String,
      default: null
    },
    // Tracking fields for engagement
    opened: {
      type: Boolean,
      default: false
    },
    opened_at: {
      type: Date,
      default: null
    },
    open_count: {
      type: Number,
      default: 0
    },
    clicked: {
      type: Boolean,
      default: false
    },
    clicked_at: {
      type: Date,
      default: null
    },
    click_count: {
      type: Number,
      default: 0
    },
    unsubscribed: {
      type: Boolean,
      default: false
    },
    unsubscribed_at: {
      type: Date,
      default: null
    },
    // Twilio message SID for SMS tracking
    twilio_message_sid: {
      type: String,
      default: null,
      index: true
    },
    // Mailgun message ID for email tracking (optional)
    mailgun_message_id: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes for better query performance
CampaignLeadSchema.index({ campaign_id: 1, createdAt: -1 });
CampaignLeadSchema.index({ lead_id: 1 });
CampaignLeadSchema.index({ dealer_id: 1 });
CampaignLeadSchema.index({ status: 1 });
CampaignLeadSchema.index({ email: 1 });
CampaignLeadSchema.index({ phone: 1 });

// Compound index for duplicate checking
CampaignLeadSchema.index({ campaign_id: 1, email: 1 });
CampaignLeadSchema.index({ campaign_id: 1, phone: 1 });

export default mongoose.models.CampaignLead || mongoose.model("CampaignLead", CampaignLeadSchema);

