// The top bar's store switcher (19 Nov 2026, SOW reference B4 - DealerSocket's "Vic Central / Power Motors NYC"
// store menu). Only for someone already inside a store through "login as" (app/api/login-as): a super admin can go to
// any store, an agency to its own stores - exactly what "login as" already lets them do, without going back to the
// admin / agency list. Dealers and their staff sign in to their one store and see no menu.
//   GET  /api/login-as/switch            -> { stores: [{ id, name, city }] }  (empty when not signed in through "login as")
//   POST /api/login-as/switch {dealerId} -> { token, user }  the new store's token, as /api/login-as returns it
// Who may switch is checked again on every call from the person who signed in (the token's `impersonated_by`), never
// from the store they are in now.

import dbConnect from "@lib/mongodb";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { cookies } from "next/headers";
import User from "@models/User";
import "@models/Role";

export const dynamic = "force-dynamic";

const STORE_LIMIT = 500;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// The person behind this dealer token, when they came in through "login as"; null otherwise.
async function signedInBy(req) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/.test(auth)) return null;
  let decoded;
  try {
    decoded = jwt.verify(auth.replace(/^Bearer\s+/, ""), process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded?.impersonated_by || !mongoose.isValidObjectId(decoded.impersonated_by)) return null;
  const by = await User.findById(decoded.impersonated_by).select("_id type").lean();
  if (!by || !["admin", "vendor"].includes(by.type) || by.type !== decoded.impersonator_type) return null;
  return by;
}

// The stores this person may enter: dealer accounts (not staff), all of them for a super admin, an agency's own.
const storeFilter = (by) => ({ type: "dealer", parent_id: null, ...(by.type === "vendor" ? { vendor_id: by._id } : {}) });

export async function GET(req) {
  await dbConnect();
  const by = await signedInBy(req);
  if (!by) return json({ stores: [] });
  const stores = await User.find(storeFilter(by))
    .select("name dealer_account_information.store_name dealer_account_information.store_city")
    .sort({ name: 1 }).limit(STORE_LIMIT).lean();
  return json({
    stores: stores.map((s) => ({ id: String(s._id), name: s.dealer_account_information?.store_name || s.name || "Store",
      city: s.dealer_account_information?.store_city || null })),
  });
}

export async function POST(req) {
  await dbConnect();
  const by = await signedInBy(req);
  if (!by) return json({ message: "Only an AutoPulse admin or agency signed in through \"login as\" can switch stores" }, 403);
  const { dealerId } = await req.json().catch(() => ({}));
  if (!mongoose.isValidObjectId(dealerId)) return json({ message: "Pick a store" }, 400);
  const store = await User.findOne({ _id: dealerId, ...storeFilter(by) })
    .select("-password -otp -otpExpiresAt -otpAttempts -resetToken -resetTokenExpires").populate("role");
  if (!store) return json({ message: "You can't open this store" }, 403);

  // The same token and cookie /api/login-as gives.
  const token = jwt.sign({ userId: store._id, role: store?.role?.name, type: store.type,
    impersonated_by: String(by._id), impersonator_type: by.type }, process.env.JWT_SECRET, { expiresIn: "24h" });
  const cookieStore = await cookies();
  cookieStore.set({ name: `${store.type}token`, value: token, httpOnly: true,
    secure: process.env.NODE_ENV === "production", maxAge: 3600, path: "/" });
  return json({ token, user: store, impersonatedBy: String(by._id) });
}
