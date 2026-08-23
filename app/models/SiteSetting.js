import mongoose from "mongoose";

const SocialLinksSchema = new mongoose.Schema(
  {
    facebook: { type: String, default: "" },
    instagram: { type: String, default: "" },
    twitter: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    youtube: { type: String, default: "" },
  },
  { _id: false }
);

// Singleton document (key: "default") holding site-wide contact/social info
const SiteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    address: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    social: { type: SocialLinksSchema, default: () => ({}) },
  },
  { timestamps: true }
);

export default mongoose.models.SiteSetting || mongoose.model("SiteSetting", SiteSettingSchema);
