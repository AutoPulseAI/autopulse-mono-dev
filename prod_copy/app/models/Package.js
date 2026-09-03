// models/Package.js
import mongoose from "mongoose";

const PackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number }, // Now optional (for non-dealer-based packages)
    duration: { type: Number }, // in days
    hide: { type: Boolean, default: false }, // when true, do not show on front
    max_dealers: { type: Number, default: 0 },
    features: [{ type: String }],
    is_active: { type: Boolean, default: true },
    discount: { type: Number, default: 0 },
    stripe_price_id: { type: String },
    for_user_type: { 
      type: String,
      enum: ["vendor", "dealer"],
      required: true 
    },
    // New fields for per-dealer pricing
    pricing_model: {
      type: String,
      enum: ["flat", "per_dealer"],
      default: "flat"
    },
    base_fee: { type: Number, default: 0 }, // Fixed monthly fee
    price_per_dealer: { type: Number, default: 0 }, // Cost per additional dealer
    min_dealers: { type: Number, default: 1 }, // Minimum dealers required
    billing_interval: {
      type: String,
      enum: ["month", "year"],
      default: "month"
    },
  },
  { timestamps: true }
);

export default mongoose.models.Package || mongoose.model("Package", PackageSchema);