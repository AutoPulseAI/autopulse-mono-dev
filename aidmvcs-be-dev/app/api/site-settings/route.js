import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import SiteSetting from "@models/SiteSetting";
import { requireAdmin } from "@lib/adminAuth";

const DEFAULTS = {
  address: "651 DeRose ln , freehold nj 07728",
  phone: "7186075434",
  email: "contact@autopulse.ai",
  social: { facebook: "", instagram: "", twitter: "", linkedin: "", youtube: "" },
};

// Public: site-wide contact info and social links
export async function GET() {
  try {
    await dbConnect();
    const settings = await SiteSetting.findOne({ key: "default" }).lean();
    return NextResponse.json({
      settings: settings
        ? {
            address: settings.address,
            phone: settings.phone,
            email: settings.email,
            social: { ...DEFAULTS.social, ...(settings.social || {}) },
          }
        : DEFAULTS,
    });
  } catch (error) {
    console.error("Error fetching site settings:", error);
    return NextResponse.json({ settings: DEFAULTS }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    await dbConnect();

    const update = {};
    if (body.address !== undefined) update.address = String(body.address);
    if (body.phone !== undefined) update.phone = String(body.phone);
    if (body.email !== undefined) update.email = String(body.email);
    if (body.social !== undefined) {
      update.social = {};
      for (const network of ["facebook", "instagram", "twitter", "linkedin", "youtube"]) {
        update.social[network] = String(body.social?.[network] || "").trim();
      }
    }

    const settings = await SiteSetting.findOneAndUpdate(
      { key: "default" },
      { $set: update },
      { new: true, upsert: true }
    ).lean();

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Error saving site settings:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
