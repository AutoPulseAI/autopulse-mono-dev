import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import RawAdfPayload from "@models/RawAdfPayload";
import User from "@models/User";
import { isAuthorizedForDealer } from "@lib/customerListing";

function jsonError(message, status) {
  return NextResponse.json({ message }, { status });
}

async function loadAuthenticatedUser(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !/^Bearer\s+\S+$/.test(authHeader)) return null;

  const token = authHeader.replace(/^Bearer\s+/, "");
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded?.userId || !mongoose.isValidObjectId(decoded.userId)) return null;

  return User.findById(decoded.userId).select("_id type parent_id vendor_id");
}

// Returns the raw ADF/XML text captured for a lead, if any. The Lead document
// itself only stores the parsed fields - the raw payload lives in
// RawAdfPayload, keyed by {dealer_id, message_id}, saved by
// saveRawAdfPayload() in app/worker/emailWorker.js.
export async function GET(req, { params }) {
  try {
    await dbConnect();
    const currentUser = await loadAuthenticatedUser(req);
    if (!currentUser) return jsonError("Unauthorized", 401);

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return jsonError("Invalid lead id", 400);

    const lead = await Lead.findById(id).select("dealer_id sourcemail").lean();
    if (!lead) return jsonError("Lead not found", 404);

    if (!(await isAuthorizedForDealer(currentUser, lead.dealer_id))) {
      return jsonError("Forbidden", 403);
    }

    if (!lead.sourcemail) return jsonError("No ADF payload for this lead", 404);

    // Prefer the ADF captured from the email body; fall back to an attachment.
    const rawAdf =
      (await RawAdfPayload.findOne({
        dealer_id: lead.dealer_id,
        message_id: lead.sourcemail,
        source: "body",
      }).lean()) ||
      (await RawAdfPayload.findOne({
        dealer_id: lead.dealer_id,
        message_id: lead.sourcemail,
        source: "attachment",
      }).lean());

    if (!rawAdf) return jsonError("No ADF payload found", 404);

    return NextResponse.json({
      data: { raw_xml: rawAdf.raw_xml, source: rawAdf.source },
    });
  } catch (error) {
    console.error("ADF fetch failed:", error);
    return jsonError("Internal server error", 500);
  }
}
