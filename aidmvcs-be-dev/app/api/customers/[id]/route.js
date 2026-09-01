import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
import Lead from "@models/Lead";
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

export async function GET(req, { params }) {
  try {
    await dbConnect();
    const currentUser = await loadAuthenticatedUser(req);
    if (!currentUser) return jsonError("Unauthorized", 401);

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return jsonError("Invalid customer id", 400);

    const url = new URL(req.url);
    const dealerId = url.searchParams.get("dealer_id")?.trim();
    if (!dealerId) return jsonError("dealer_id is required", 400);

    if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
      return jsonError("Forbidden", 403);
    }

    const customer = await Customer.findOne({ _id: id, dealer_id: dealerId }).lean();
    if (!customer) return jsonError("Customer not found", 404);

    const leadCount = await Lead.countDocuments({ customer_id: customer._id });

    return NextResponse.json({ data: { ...customer, lead_count: leadCount } });
  } catch (error) {
    console.error("Customer detail fetch failed:", error);
    return jsonError("Internal server error", 500);
  }
}
