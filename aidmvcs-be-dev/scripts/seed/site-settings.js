/**
 * Seeds default site settings (contact info + social links).
 */
import { connectDb, disconnectDb, mongoose } from "./connect.js";

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
const SiteSetting = mongoose.models.SiteSetting || mongoose.model("SiteSetting", SiteSettingSchema);

export const DEFAULT_SITE_SETTINGS = {
  key: "default",
  address: "651 DeRose ln , freehold nj 07728",
  phone: "7186075434",
  email: "contact@autopulse.ai",
  social: {
    facebook: "",
    instagram: "",
    twitter: "",
    linkedin: "",
    youtube: "",
  },
};

export async function seedSiteSettings({ force = false } = {}) {
  const existing = await SiteSetting.findOne({ key: "default" });

  if (existing && !force) {
    console.log("Site settings already exist, skipping (use --force to overwrite)");
    return;
  }

  await SiteSetting.findOneAndUpdate(
    { key: "default" },
    { $set: DEFAULT_SITE_SETTINGS },
    { upsert: true, new: true }
  );
  console.log("Site settings seeded");
}

async function main() {
  const force = process.argv.includes("--force");
  await connectDb();
  await seedSiteSettings({ force });
  await disconnectDb();
  console.log("Site settings seed complete");
}

if (process.argv[1]?.endsWith("site-settings.js")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
