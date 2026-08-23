// models/Subscription.js
import mongoose from "mongoose";

const SubscriptionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    package_id: { type: mongoose.Schema.Types.ObjectId, ref: "Package", required: true },
    stripe_subscription_id: { type: String },
    status: { 
      type: String,
      enum: ["active", "canceled", "past_due", "unpaid", "incomplete", "pending_cancellation"], // Fixed spelling
      default: "incomplete"
     
    },
    price: {type:Number,required: false,min: 0},
    start_date: { type: Date },
    end_date: { type: Date },
    is_auto_renew: { type: Boolean, default: true },
    is_manual: { type: Boolean, default: false }, // for manually assigned packages
    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // for manually assigned packages
  },
  { timestamps: true }
);

export default mongoose.models.Subscription || mongoose.model("Subscription", SubscriptionSchema);