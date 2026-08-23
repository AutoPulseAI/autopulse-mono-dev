import mongoose from "mongoose";

const VehicleClickSchema = new mongoose.Schema(
  {
    dealer_id: { 
      type: mongoose.Schema.Types.Mixed, // Can be ObjectId or String
      ref: "User", 
      required: true,
      index: true
    },
    vehicle_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Vehicle", 
      required: true,
      index: true
    },
    vin: { 
      type: String,
      index: true
    },
    shortCode: { 
      type: String, 
      index: true 
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
VehicleClickSchema.index({ dealer_id: 1, clickedAt: -1 });
VehicleClickSchema.index({ dealer_id: 1, createdAt: -1 });
VehicleClickSchema.index({ vehicle_id: 1, clickedAt: -1 });
VehicleClickSchema.index({ vehicle_id: 1, createdAt: -1 });
VehicleClickSchema.index({ shortCode: 1, clickedAt: -1 });
VehicleClickSchema.index({ shortCode: 1, createdAt: -1 });
VehicleClickSchema.index({ vin: 1, clickedAt: -1 });
VehicleClickSchema.index({ vin: 1, createdAt: -1 });
VehicleClickSchema.index({ createdAt: -1 });

export default mongoose.models.VehicleClick || mongoose.model("VehicleClick", VehicleClickSchema);

