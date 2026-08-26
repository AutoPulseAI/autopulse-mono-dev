import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
import Lead from "@models/Lead";
import User from "@models/User";
import { normalizeEmail, normalizePhone } from "@lib/customerResolver";
import { escapeRegex, isAuthorizedForDealer, parseBoundedInteger } from "@lib/customerListing";

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

export async function GET(req) {
  try {
    await dbConnect();
    const currentUser = await loadAuthenticatedUser(req);
    if (!currentUser) return jsonError("Unauthorized", 401);

    const url = new URL(req.url);
    const dealerId = url.searchParams.get("dealer_id")?.trim();
    if (!dealerId) return jsonError("dealer_id is required", 400);

    if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
      return jsonError("Forbidden", 403);
    }

    const page = parseBoundedInteger(url.searchParams.get("page"), 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = parseBoundedInteger(url.searchParams.get("limit"), 10, 1, 100);
    if (page === null || limit === null) {
      return jsonError("page must be at least 1 and limit must be between 1 and 100", 400);
    }

    const query = { dealer_id: dealerId };
    const name = url.searchParams.get("name")?.trim();
    const email = url.searchParams.get("email");
    const phone = url.searchParams.get("phone");

    if (name) query.name = { $regex: escapeRegex(name), $options: "i" };

    if (email !== null) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return jsonError("email is invalid", 400);
      query["emails.value"] = { $regex: escapeRegex(normalizedEmail), $options: "i" };
    }

    if (phone !== null) {
      const normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) return jsonError("phone is invalid", 400);
      query["phones.value"] = { $regex: escapeRegex(normalizedPhone) };
    }

    const skip = (page - 1) * limit;
    const [customers, totalItems] = await Promise.all([
      Customer.find(query)
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Customer.countDocuments(query),
    ]);

    const leadCounts = customers.length > 0
      ? await Lead.aggregate([
          { $match: { customer_id: { $in: customers.map((c) => c._id) } } },
          { $group: { _id: "$customer_id", count: { $sum: 1 } } },
        ])
      : [];
    const leadCountByCustomerId = new Map(leadCounts.map((row) => [String(row._id), row.count]));
    const customersWithLeadCount = customers.map((customer) => ({
      ...customer,
      lead_count: leadCountByCustomerId.get(String(customer._id)) || 0,
    }));

    const totalPages = Math.ceil(totalItems / limit);
    return NextResponse.json({
      data: customersWithLeadCount,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Customer listing failed:", error);
    return jsonError("Internal server error", 500);
  }
}
