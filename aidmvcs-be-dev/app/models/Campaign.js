import mongoose from "mongoose";

const CampaignSchema = new mongoose.Schema(
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
    scheduled_date: {
      type: Date,
      default: null
    },
    actual_scheduled_date: {
      type: Date,
      default: null,
      index: true // Index for cron job queries
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "active", "completed", "cancelled"],
      default: "draft"
    },
    // Note: Leads are now stored in separate CampaignLead collection
    // This field is kept for backward compatibility and will store count only
    // Use CampaignLead model to query actual leads
    message_content: {
      subject: {
        type: String,
        default: ""
      },
      body: {
        type: String,
        default: ""
      }
    },
    attachments: {
      type: [{
        filename: String,
        url: String,
        contentId: String, // For inline images in email
        size: Number,
        mimeType: String
      }],
      default: []
    },
    stats: {
      total_leads: {
        type: Number,
        default: 0
      },
      sent: {
        type: Number,
        default: 0
      },
      delivered: {
        type: Number,
        default: 0
      },
      failed: {
        type: Number,
        default: 0
      },
      bounced: {
        type: Number,
        default: 0
      },
      // Unique opens (for email campaigns)
      unique_opens: {
        type: Number,
        default: 0
      },
      // Total opens including repeat opens
      total_opens: {
        type: Number,
        default: 0
      },
      // Unique clicks (for links in campaigns)
      unique_clicks: {
        type: Number,
        default: 0
      },
      // Total clicks including repeat clicks
      total_clicks: {
        type: Number,
        default: 0
      },
      // Unsubscribed count
      unsubscribed: {
        type: Number,
        default: 0
      }
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    settings: {
      lead_handling: {
        type: String,
        enum: ["create_new", "override_conversation"],
        default: "create_new"
      },
      use_replies_for_ai: {
        type: Boolean,
        default: false
      }
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries
CampaignSchema.index({ dealer_id: 1, createdAt: -1 });
CampaignSchema.index({ status: 1 });

export default mongoose.models.Campaign || mongoose.model("Campaign", CampaignSchema);

