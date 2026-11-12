import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
import TradeIn, { TRADE_IN_STATUS_VALUES } from "@models/TradeIn";
import User from "@models/User";
import { isAuthorizedForDealer } from "@lib/customerListing";
import { customerFamily } from "@lib/customerFamily";
import { hasPermission } from "@lib/staffPermission";

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

  return User.findById(decoded.userId).select("_id name type parent_id vendor_id role");
}

// Shared by GET/POST/PUT: validates the customer id, authenticates the
// caller, checks dealer authorization, and confirms the Customer exists
// under that dealer - returning a Response to send back early on any
// failure, or { currentUser, customer } to continue.
async function authorizeCustomerRequest(req, id, dealerId) {
  if (!mongoose.isValidObjectId(id)) return { error: jsonError("Invalid customer id", 400) };

  const currentUser = await loadAuthenticatedUser(req);
  if (!currentUser) return { error: jsonError("Unauthorized", 401) };

  if (!dealerId) return { error: jsonError("dealer_id is required", 400) };
  if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
    return { error: jsonError("Forbidden", 403) };
  }

  const customer = await Customer.findOne({ _id: id, dealer_id: dealerId }).select("_id").lean();
  if (!customer) return { error: jsonError("Customer not found", 404) };

  return { currentUser, customer };
}

// A field the body omits entirely is left untouched on update; a field
// explicitly sent as "" or null means the dealer cleared it, which must
// reach Mongo as `null` (not `undefined` - the Mongo driver silently drops
// `undefined` values from a $set, so an update meant to clear a value would
// otherwise leave the previous one in place).
function parseNumericField(key, rawValue, { integer = false, min = null, max = null } = {}) {
  if (rawValue === undefined) return { skip: true };
  if (rawValue === null || rawValue === "") return { value: null };
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return { error: `${key} must be a valid number` };
  if (integer && !Number.isInteger(value)) return { error: `${key} must be a whole number` };
  if (min !== null && value < min) return { error: `${key} must be at least ${min}` };
  if (max !== null && value > max) return { error: `${key} must be at most ${max}` };
  return { value };
}

const CURRENT_YEAR = new Date().getFullYear();
const NUMERIC_FIELD_SPECS = {
  year: { integer: true, min: 1900, max: CURRENT_YEAR + 2 },
  miles: { integer: true, min: 0 },
  trade_offer_amount: { min: 0 },
  trade_acv_amount: { min: 0 },
  payoff_amount: { min: 0 },
};
// Finance fields (G-063: "role-protect finance"): read and changed by managers ("Manage Leads") only.
const FINANCE_FIELDS = ["payoff_amount", "lienholder"];
// Appraisal history (G-063): the values whose every change is kept.
const TRACKED_FIELDS = ["trade_offer_amount", "trade_acv_amount", "payoff_amount", "miles", "condition"];
const hideFinance = (t) => { const out = { ...t }; FINANCE_FIELDS.forEach((k) => delete out[k]);
  if (Array.isArray(out.value_history)) out.value_history = out.value_history.filter((h) => !FINANCE_FIELDS.includes(h.field));
  return out; };

// Duplicate VIN check (G-062): the same VIN as another trade-in at this dealership - a warning, never a block (the
// same car can come back as a trade later).
async function duplicateVinWarnings(dealerId, vin, excludeId) {
  if (!vin) return [];
  const others = await TradeIn.find({ dealer_id: dealerId, vin: String(vin).trim().toUpperCase(),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select("customer_id createdAt").limit(5).lean();
  if (!others.length) return [];
  const names = new Map((await Customer.find({ _id: { $in: others.map((o) => o.customer_id) } }).select("name").lean())
    .map((c) => [String(c._id), c.name]));
  return others.map((o) => `VIN ${String(vin).toUpperCase()} is already a trade-in for ${names.get(String(o.customer_id)) || "another customer"}`
    + ` (added ${new Date(o.createdAt).toLocaleDateString("en-US")})`);
}

// Builds a { field: value } update object from a trade-in request body,
// coercing/bounding numeric fields and validating status against the fixed
// enum. Returns { updates } or { error: jsonError(...) }.
function buildTradeInFields(body, { requireVin, requireStatus }) {
  const updates = {};

  if (body.vin !== undefined) updates.vin = body.vin?.toString().trim() || null;
  if (requireVin && !updates.vin) return { error: jsonError("vin is required", 400) };

  if (body.status !== undefined) updates.status = body.status?.toString().trim();
  if (requireStatus && !updates.status) updates.status = "open";
  if (updates.status && !TRADE_IN_STATUS_VALUES.includes(updates.status)) {
    return { error: jsonError(`status must be one of: ${TRADE_IN_STATUS_VALUES.join(", ")}`, 400) };
  }

  ["make", "model", "trim", "exterior_color", "interior_color", "trade_stock_number", "condition", "notes", "lienholder"].forEach((key) => {
    if (body[key] !== undefined) updates[key] = body[key]?.toString().trim() || null;
  });

  for (const [key, spec] of Object.entries(NUMERIC_FIELD_SPECS)) {
    const result = parseNumericField(key, body[key], spec);
    if (result.skip) continue;
    if (result.error) return { error: jsonError(result.error, 400) };
    updates[key] = result.value;
  }

  return { updates };
}

export async function GET(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;
    const url = new URL(req.url);
    const dealerId = url.searchParams.get("dealer_id")?.trim();

    const authResult = await authorizeCustomerRequest(req, id, dealerId);
    if (authResult.error) return authResult.error;

    const page = parseInt(url.searchParams.get("page")) || 1;
    const limit = parseInt(url.searchParams.get("limit")) || 5;

    // With the trade-ins of customers merged into this one (G-008).
    const filter = { dealer_id: dealerId, customer_id: { $in: await customerFamily(id, dealerId) } };
    const [tradeIns, totalItems] = await Promise.all([
      TradeIn.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TradeIn.countDocuments(filter),
    ]);

    const finance = await hasPermission(authResult.currentUser, "Manage Leads");
    const vins = [...new Set(tradeIns.map((t) => t.vin).filter(Boolean))];
    const vinCounts = vins.length ? await TradeIn.aggregate([
      { $match: { dealer_id: dealerId, vin: { $in: vins } } }, { $group: { _id: "$vin", n: { $sum: 1 } } }]) : [];
    const dupVins = new Set(vinCounts.filter((v) => v.n > 1).map((v) => v._id));
    return NextResponse.json({
      can_see_finance: finance,
      data: tradeIns.map((t) => ({ ...(finance ? t : hideFinance(t)), duplicate_vin: dupVins.has(t.vin) })),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(totalItems / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Trade-in list fetch failed:", error);
    return jsonError("Internal server error", 500);
  }
}

export async function POST(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await req.json();
    const dealerId = body.dealer_id?.toString().trim();

    const authResult = await authorizeCustomerRequest(req, id, dealerId);
    if (authResult.error) return authResult.error;

    const { updates, error } = buildTradeInFields(body, { requireVin: true, requireStatus: true });
    if (error) return error;
    const finance = await hasPermission(authResult.currentUser, "Manage Leads");
    if (!finance && FINANCE_FIELDS.some((k) => updates[k] != null)) {
      return jsonError("Only managers can enter the payoff and lienholder", 403);
    }
    const warnings = await duplicateVinWarnings(dealerId, updates.vin, null);
    const firstValues = TRACKED_FIELDS.filter((k) => updates[k] != null).map((k) => ({ at: new Date(),
      by: authResult.currentUser._id, by_name: authResult.currentUser.name || null, field: k, from: null, to: updates[k] }));

    const tradeIn = await TradeIn.create({
      ...(firstValues.length ? { value_history: firstValues } : {}),
      ...updates,
      dealer_id: dealerId,
      customer_id: id,
      created_by: authResult.currentUser._id,
    });

    const out = tradeIn.toObject ? tradeIn.toObject() : tradeIn;
    return NextResponse.json({ data: finance ? out : hideFinance(out), warnings }, { status: 201 });
  } catch (error) {
    if (error.name === "ValidationError") return jsonError(error.message, 400);
    console.error("Trade-in create failed:", error);
    return jsonError("Internal server error", 500);
  }
}

export async function PUT(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await req.json();
    const dealerId = body.dealer_id?.toString().trim();

    const authResult = await authorizeCustomerRequest(req, id, dealerId);
    if (authResult.error) return authResult.error;

    const tradeInId = body._id?.toString().trim();
    if (!tradeInId || !mongoose.isValidObjectId(tradeInId)) {
      return jsonError("Invalid trade-in id", 400);
    }

    const { updates, error } = buildTradeInFields(body, { requireVin: false, requireStatus: false });
    if (error) return error;

    const finance = await hasPermission(authResult.currentUser, "Manage Leads");
    if (!finance && FINANCE_FIELDS.some((k) => updates[k] !== undefined)) {
      return jsonError("Only managers can change the payoff and lienholder", 403);
    }
    // A trade-in of a customer merged into this one (G-008) is edited from the kept customer's page.
    const family = { $in: await customerFamily(id, dealerId) };
    const existing = await TradeIn.findOne({ _id: tradeInId, dealer_id: dealerId, customer_id: family }).lean();
    if (!existing) return jsonError("Trade-in not found", 404);
    const merged = { ...existing, ...updates };
    if (!merged.vin && (!existing.raw_adf_payload_id || !(merged.year && merged.make && merged.model))) {
      return jsonError(existing.raw_adf_payload_id ? "A VIN or year, make and model is required" : "vin is required", 400);
    }

    const changes = TRACKED_FIELDS.filter((k) => updates[k] !== undefined && (existing[k] ?? null) !== (updates[k] ?? null))
      .map((k) => ({ at: new Date(), by: authResult.currentUser._id, by_name: authResult.currentUser.name || null,
        field: k, from: existing[k] ?? null, to: updates[k] ?? null }));
    const tradeIn = await TradeIn.findOneAndUpdate(
      { _id: tradeInId, dealer_id: dealerId, customer_id: family },
      { $set: updates, ...(changes.length ? { $push: { value_history: { $each: changes } } } : {}) },
      { new: true, runValidators: true }
    ).lean();
    if (!tradeIn) return jsonError("Trade-in not found", 404);
    const warnings = updates.vin && updates.vin.toUpperCase() !== String(existing.vin || "").toUpperCase()
      ? await duplicateVinWarnings(dealerId, updates.vin, existing._id) : [];

    return NextResponse.json({ data: finance ? tradeIn : hideFinance(tradeIn), warnings });
  } catch (error) {
    if (error.name === "ValidationError") return jsonError(error.message, 400);
    console.error("Trade-in update failed:", error);
    return jsonError("Internal server error", 500);
  }
}
