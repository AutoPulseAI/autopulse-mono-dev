import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import moment from "moment-timezone";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
import Lead from "@models/Lead";
import User from "@models/User";
import { normalizeEmail, normalizePhone } from "@lib/customerResolver";
import { NAME_PART_FIELDS, cleanPart, joinName } from "@lib/personName";
import {
  escapeRegex,
  isAuthorizedForDealer,
  parseBoundedInteger,
  buildSourceQuery,
  CUSTOMER_SOURCE_VALUES,
} from "@lib/customerListing";

function jsonError(message, status) {
  return NextResponse.json({ message }, { status });
}

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PHONE_DIGITS = 10;

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
    let dealerId = url.searchParams.get("dealer_id")?.trim();
    if (!dealerId && currentUser) {
      dealerId = currentUser.type === "dealer"
        ? currentUser._id.toString()
        : (currentUser.parent_id ? currentUser.parent_id.toString() : null);
    }
    if (!dealerId) return jsonError("dealer_id is required", 400);

    if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
      return jsonError("Forbidden", 403);
    }

    const page = parseBoundedInteger(url.searchParams.get("page"), 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = parseBoundedInteger(url.searchParams.get("limit"), 10, 1, 100);
    if (page === null || limit === null) {
      return jsonError("page must be at least 1 and limit must be between 1 and 100", 400);
    }

    // Merged customers (G-008) are part of the customer they were merged into, not listed on their own.
    const query = { dealer_id: dealerId, merged_into: { $in: [null] } };
    const name = url.searchParams.get("name")?.trim();
    const email = url.searchParams.get("email");
    const phone = url.searchParams.get("phone");

    if (name) query.name = { $regex: escapeRegex(name), $options: "i" };
    // Looking up by last name (19 Nov 2026): starts with what was typed; the list is then in last, first order so
    // customers who share a last name sit together and are told apart by first / middle name.
    const lastName = url.searchParams.get("last_name")?.trim();
    if (lastName) query.last_name = { $regex: `^${escapeRegex(lastName)}`, $options: "i" };

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

    const source = url.searchParams.get("source");
    if (source) {
      if (!CUSTOMER_SOURCE_VALUES.includes(source)) return jsonError("source is invalid", 400);
      const leadCustomerIds = await Lead.distinct("customer_id", { dealer_id: dealerId, customer_id: { $ne: null } });
      // How their leads came in, by the same rule as the Leads list's Source type (app/lib/leadContactType.js).
      const manual = { $or: [{ source: null }, { source: { $exists: false } }, { source: { $regex: "^\\s*(email|sms|manual)?\\s*$", $options: "i" } }] };
      const byLeads = source === "phone" ? { contact_type: "phone" }
        : source === "internet" ? { $or: [{ contact_type: "internet" }, { $and: [{ contact_type: { $nin: ["internet", "phone", "walk_in"] } }, { $nor: manual.$or }] }] }
          : source === "imports" ? { source: { $in: ["csv_import", "csv_import_auto"] } } : null;
      const matchIds = byLeads ? await Lead.distinct("customer_id", { dealer_id: dealerId, customer_id: { $ne: null }, ...byLeads }) : [];
      query.$and = [...(query.$and || []), ...buildSourceQuery(source, leadCustomerIds, matchIds)];
    }

    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    if (startDate && endDate) {
      // Same dealer-timezone-aware day-boundary handling as
      // app/api/leads/route.js's createdAt filter - the frontend sends UTC
      // ISO strings already representing start/end-of-day in dealer tz, and
      // this re-derives the calendar date in dealer tz before re-applying
      // startOf/endOf('day') to guard against DST edge cases.
      const dealer = await User.findById(dealerId);
      const dealerTimezone = dealer?.dealer_account_information?.time_zone || "America/New_York";

      const startDateStr = moment.utc(startDate).tz(dealerTimezone).format("YYYY-MM-DD");
      const endDateStr = moment.utc(endDate).tz(dealerTimezone).format("YYYY-MM-DD");
      const startMoment = moment.tz(startDateStr, "YYYY-MM-DD", dealerTimezone).startOf("day");
      const endMoment = moment.tz(endDateStr, "YYYY-MM-DD", dealerTimezone).endOf("day");

      query.createdAt = { $gte: startMoment.utc().toDate(), $lte: endMoment.utc().toDate() };
    }

    const skip = (page - 1) * limit;
    const [customers, totalItems] = await Promise.all([
      Customer.find(query)
        .sort(lastName ? { last_name: 1, first_name: 1, middle_name: 1 } : { updatedAt: -1, createdAt: -1 })
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

export async function POST(req) {
  try {
    await dbConnect();
    const currentUser = await loadAuthenticatedUser(req);
    if (!currentUser) return jsonError("Unauthorized", 401);

    const body = await req.json();
    const dealerId = body.dealer_id?.toString().trim();
    if (!dealerId) return jsonError("dealer_id is required", 400);

    if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
      return jsonError("Forbidden", 403);
    }

    // The name in parts (19 Nov 2026) from the Add Customer form; a one-line `name` still works (split as a guess).
    const parts = Object.fromEntries(NAME_PART_FIELDS.map((f) => [f, cleanPart(body[f])]));
    const typedParts = Boolean(parts.first_name || parts.last_name);
    const name = (typedParts ? joinName(parts) : body.name?.toString().replace(/\s+/g, " ").trim() || "").slice(0, 120);
    if (!name) return jsonError("A first or last name is required", 400);

    let normalizedEmail = null;
    if (body.email !== undefined && body.email !== null && body.email !== "") {
      normalizedEmail = normalizeEmail(body.email);
      if (!normalizedEmail || !EMAIL_FORMAT_RE.test(normalizedEmail)) {
        return jsonError("email is invalid", 400);
      }
    }

    let normalizedPhone = null;
    if (body.phone !== undefined && body.phone !== null && body.phone !== "") {
      normalizedPhone = normalizePhone(body.phone);
      if (!normalizedPhone || normalizedPhone.length < MIN_PHONE_DIGITS) {
        return jsonError(`phone must have at least ${MIN_PHONE_DIGITS} digits`, 400);
      }
    }

    if (!normalizedEmail && !normalizedPhone) {
      return jsonError("Provide at least an email or a phone number", 400);
    }

    const duplicateQuery = {
      dealer_id: dealerId,
      $or: [
        ...(normalizedEmail ? [{ "emails.value": normalizedEmail }] : []),
        ...(normalizedPhone ? [{ "phones.value": normalizedPhone }] : []),
      ],
    };

    const existing = await Customer.findOne(duplicateQuery).select("_id");
    if (existing) {
      return jsonError("A customer with this email or phone number already exists", 409);
    }

    const customer = new Customer({
      dealer_id: dealerId,
      name,
      ...(typedParts ? { ...Object.fromEntries(Object.entries(parts).filter(([, v]) => v)), name_parts_from: "staff" } : {}),
      manual_entry: true,
      dealervault_upload: false,
      inbound_lead: false,
      followup_preference: body.followup_preference || undefined,
      preferred_communication_mode: body.preferred_communication_mode || undefined,
      user_language: body.user_language || undefined,
      emails: normalizedEmail
        ? [{ value: normalizedEmail, is_primary: true, source: "manual", added_at: new Date() }]
        : [],
      phones: normalizedPhone
        ? [{ value: normalizedPhone, is_primary: true, source: "manual", added_at: new Date() }]
        : [],
    });

    const savedCustomer = await customer.save();

    // The pre-check above is a read-then-insert race: Customer's
    // dealer_id+emails.value/phones.value indexes aren't unique (see
    // CUSTOMER_MAPPING_INDEX's comment in the model for why that hasn't
    // been flipped on yet), so two concurrent requests for the same
    // email/phone can both pass it. Self-heal instead of relying on the
    // index: re-check post-insert and, if another matching customer now
    // exists, deterministically keep the earliest-created one and delete
    // this one - so at most one customer per email/phone ever survives.
    const winner = await Customer.findOne(duplicateQuery)
      .sort({ createdAt: 1, _id: 1 })
      .select("_id");
    if (winner && String(winner._id) !== String(savedCustomer._id)) {
      await Customer.deleteOne({ _id: savedCustomer._id });
      return jsonError("A customer with this email or phone number already exists", 409);
    }

    return NextResponse.json({ data: savedCustomer }, { status: 201 });
  } catch (error) {
    console.error("Customer creation failed:", error);
    return jsonError("Internal server error", 500);
  }
}
