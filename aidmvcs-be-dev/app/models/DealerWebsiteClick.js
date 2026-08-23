import mongoose from "mongoose";

const DealerWebsiteClickSchema = new mongoose.Schema(
  {
    dealer_id: { 
      type: mongoose.Schema.Types.Mixed, // Can be ObjectId or String
      ref: "User", 
      required: true,
      index: true
    },
    shortCode: { 
      type: String, 
      required: true,
      index: true 
    },
    originalUrl: {
      type: String,
      required: true
    },
    isBot: { 
      type: Boolean, 
      default: false 
    },
    userAgent: { 
      type: String 
    },
    ip: { 
      type: String 
    },
    referrer: { 
      type: String 
    },
    source: { 
      type: String,
      enum: ['email', 'sms', 'other', null],
      default: null
    },
    clickedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  { 
    timestamps: true // Enable createdAt and updatedAt
  }
);

// Compound indexes for common queries
DealerWebsiteClickSchema.index({ dealer_id: 1, clickedAt: -1 });
DealerWebsiteClickSchema.index({ dealer_id: 1, createdAt: -1 });
DealerWebsiteClickSchema.index({ shortCode: 1, clickedAt: -1 });
DealerWebsiteClickSchema.index({ shortCode: 1, createdAt: -1 });
DealerWebsiteClickSchema.index({ dealer_id: 1, shortCode: 1 });
DealerWebsiteClickSchema.index({ createdAt: -1 });

export default mongoose.models.DealerWebsiteClick || mongoose.model("DealerWebsiteClick", DealerWebsiteClickSchema);

