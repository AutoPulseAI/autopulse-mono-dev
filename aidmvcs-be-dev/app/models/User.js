import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      lowercase: true,
    },
    name: { type: String, required: true },
    password: { type: String, required: true },
    type: {
      type: String,
      enum: ["admin", "dealer", "vendor"],
      required: true,
    },
    dv_dealer_id: { type: String, trim: true },
    phone: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true; // Allow empty
          return /^[\d\s+-]+$/.test(v);
        },
        message: props => `${props.value} is not a valid phone number!`
      }
    },
    website: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true; // Allow empty
          return /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(v);
        },
        message: props => `${props.value} is not a valid website URL!`
      }
    },
    
    role: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: false },
    parent_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    dealer_account_information: { 
      type: Object, 
      default: {},
      validate: {
        validator: function(v) {
          // If sms_conversion_phone exists, validate and format it
          if (v && v.sms_conversion_phone) {
            let phone = v.sms_conversion_phone.toString().trim();
            
            // Remove any non-digit characters except +
            phone = phone.replace(/[^\d+]/g, '');
            
            // Handle different phone number formats
            if (phone.startsWith('+1') && phone.length === 12) {
              // Already in correct format: +1XXXXXXXXXX
              return true;
            } else if (phone.startsWith('1') && phone.length === 11) {
              // Format: 1XXXXXXXXXX -> convert to +1XXXXXXXXXX
              v.sms_conversion_phone = '+1' + phone.substring(1);
              return true;
            } else if (phone.length === 10) {
              // Format: XXXXXXXXXX -> convert to +1XXXXXXXXXX
              v.sms_conversion_phone = '+1' + phone;
              return true;
            } else if (phone.startsWith('0') && phone.length === 11) {
              // Format: 0XXXXXXXXXX -> convert to +1XXXXXXXXXX (remove leading 0)
              v.sms_conversion_phone = '+1' + phone.substring(1);
              return true;
            } else {
              // Invalid format
              return false;
            }
          }
          return true; // Allow empty or missing
        },
        message: props => 'SMS conversion phone must be a valid 10-digit number (will be formatted as +1XXXXXXXXXX)'
      }
    },
    current_subscription: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    stripe_customer_id: { type: String },
    package_dealers_allowed: { type: Number, default: 0 }, // for vendors
    package_dealers_used: { type: Number, default: 0 }, // for vendors
    package_expiry: { type: Date }, // for both vendors and dealers
    setting: { type: Object, default: {} },
    otp: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },
    branding_information:{ type: Object, default: {} },
    // Appointment Reminder Settings
    appointment_reminder_settings: { type: Object, default: {} },
    // Managerial Review Messaging Settings
    managerial_review_settings: { type: Object, default: {} },
    // Report Schedule Settings
    report_schedule_settings: {
      enabled: { type: Boolean, default: false },
      default_email: { type: String, default: "" },
      timezone: { type: String, default: "America/New_York" },
      schedules: [
        {
          id: { type: String, required: true },
          active: { type: Boolean, default: false },
          frequency: { 
            type: String, 
            enum: ["daily", "weekly", "monthly", "yearly"],
            required: true 
          },
          time: { 
            type: String, 
            required: true,
            validate: {
              validator: function(v) {
                return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
              },
              message: props => `${props.value} is not a valid time format! Use HH:MM`
            }
          },
          days: { 
            type: [String], 
            default: []
          }
        }
      ],
      include_metrics: {
        leads: { type: Boolean, default: true },
        conversations: { type: Boolean, default: true },
        vehicles: { type: Boolean, default: true },
        revenue: { type: Boolean, default: true }
      },
      custom_message: { type: String, default: "" },
      last_settings_updated: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

UserSchema.index(
  { dv_dealer_id: 1 },
  { unique: true, partialFilterExpression: { type: "dealer", dv_dealer_id: { $type: "string" } } }
);

// One canonical email per account (unique index applies to lowercase storage).
UserSchema.pre("validate", function (next) {
  if (this.email != null && typeof this.email === "string") {
    this.email = this.email.trim().toLowerCase();
  }
  next();
});

const normalizeUpdateEmail = (update) => {
  if (!update || typeof update !== "object") return;
  if (update.email != null && typeof update.email === "string") {
    update.email = update.email.trim().toLowerCase();
  }
  if (update.$set?.email != null && typeof update.$set.email === "string") {
    update.$set.email = update.$set.email.trim().toLowerCase();
  }
};

UserSchema.pre(["findOneAndUpdate", "findByIdAndUpdate", "updateOne"], function (next) {
  normalizeUpdateEmail(this.getUpdate());
  next();
});

// Pre-save hook to clean up empty fields
UserSchema.pre('save', function(next) {
  //if (this.phone === '') this.phone = null;
  //if (this.website === '') this.website = null;
  next();
});

export default mongoose.models.User || mongoose.model("User", UserSchema);
