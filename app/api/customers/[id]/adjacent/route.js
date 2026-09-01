import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
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

// Mirrors the sort order used by the customer list (GET /api/customers):
// updatedAt desc, createdAt desc - with _id added as a tiebreaker so the
// keyset comparison below is unambiguous even when two customers share the
// exact same updatedAt/createdAt.
function keysetQuery(dealerId, cursor, op) {
  return {
    dealer_id: dealerId,
    $or: [
      { updatedAt: { [op]: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, createdAt: { [op]: cursor.createdAt } },
      { updatedAt: cursor.updatedAt, createdAt: cursor.createdAt, _id: { [op]: cursor._id } },
    ],
  };
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

    const current = await Customer.findOne({ _id: id, dealer_id: dealerId })
      .select("updatedAt createdAt")
      .lean();
    if (!current) return jsonError("Customer not found", 404);

    // "previous" = the customer immediately above this one in the list (a
    // larger sort key); "next" = the one immediately below (a smaller key).
    const [previous, next] = await Promise.all([
      Customer.findOne(keysetQuery(dealerId, current, "$gt"))
        .sort({ updatedAt: 1, createdAt: 1, _id: 1 })
        .select("name")
        .lean(),
      Customer.findOne(keysetQuery(dealerId, current, "$lt"))
        .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
        .select("name")
        .lean(),
    ]);

    return NextResponse.json({
      data: {
        previous: previous ? { _id: previous._id, name: previous.name } : null,
        next: next ? { _id: next._id, name: next.name } : null,
      },
    });
  } catch (error) {
    console.error("Adjacent customers fetch failed:", error);
    return jsonError("Internal server error", 500);
  }
}
