// Shared by the dealer-portal AI routes (app/api/dealer-ai/**), which back the
// staff screens under app/dealer/ai/** and the AI panel on a lead.
//
// The chain is the same as app/api/upsell/recommend/route.js: the browser sends
// the dealer's Bearer token (localStorage "dealertoken"), this file checks it and
// that the user works for the dealer (isAuthorizedForDealer), and only then is the
// AI service called server-side with the shared secret. The browser never talks
// to the AI service and never sees the secret.
//
// The folder starts with "_" so Next.js never serves it as a route.

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import { loadAuthenticatedUser } from "@lib/apiAuth";
import { isAuthorizedForDealer } from "@lib/customerListing";
import User from "@models/User";
import Lead from "@models/Lead";
import "@models/Role";
import "@models/Permission";
import { assignedOnlyScope, filterRowsToAssigned } from "@lib/ai/assignedScope";

const AI_TIMEOUT_MS = 8_000;

export function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

// The dealer a signed-in user works for: a dealer account is its own dealer,
// staff belong to their parent dealer. Admins and vendors must name the dealer
// (?dealer_id=), which isAuthorizedForDealer then checks.
export async function requireDealerSession(req, requestedDealerId) {
  await dbConnect();
  const user = await loadAuthenticatedUser(req);
  if (!user) return { error: jsonError("Your session has expired. Please sign in again.", 401) };

  const dealerId = requestedDealerId
    || (user.type === "dealer" ? String(user.parent_id || user._id) : null);
  if (!dealerId || !mongoose.isValidObjectId(dealerId)) {
    return { error: jsonError("Pick a dealership first.", 400) };
  }
  if (!(await isAuthorizedForDealer(user, dealerId))) {
    return { error: jsonError("You don't have access to this dealership.", 403) };
  }
  return { user, dealerId: String(dealerId) };
}

// A lead the signed-in user may see (its dealer is theirs).
export async function requireLeadAccess(req, params) {
  await dbConnect();
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return { error: jsonError("Invalid lead id", 400) };
  const user = await loadAuthenticatedUser(req);
  if (!user) return { error: jsonError("Your session has expired. Please sign in again.", 401) };
  const lead = await Lead.findById(id).select("dealer_id customer_id name phone email fe_lead_status").lean();
  if (!lead) return { error: jsonError("Lead not found", 404) };
  if (!lead.dealer_id || !(await isAuthorizedForDealer(user, lead.dealer_id))) {
    return { error: jsonError("You don't have access to this lead.", 403) };
  }
  return { user, lead, leadId: String(lead._id), dealerId: String(lead.dealer_id) };
}

// --- Assigned-only staff (agentic-upsell MASTER_PLAN_4 stream R) ---------------------------------------------
// Staff with "View Assigned Leads" but not "Manage Leads" see only their own leads (as app/api/leads/route.js
// does), so the call tasks and AI alerts they get are only for leads assigned to them. The pure rule and the
// filter live in @lib/ai/assignedScope (tested by the CRM's node tests).
export async function assignedOnlyUserId(user) {
  if (!user?.parent_id) return null; // the dealer account itself, admins, vendors: everything
  const full = await User.findById(user._id)
    .select("parent_id role")
    .populate({ path: "role", populate: { path: "permissions" } })
    .lean();
  return assignedOnlyScope(full);
}

// The rows whose lead is assigned to `userId` (null: every row).
export async function keepAssignedRows(dealerId, userId, rows) {
  if (!userId) return rows;
  const ids = [...new Set(rows.map((r) => r.lead_id).filter((id) => mongoose.isValidObjectId(id)))];
  const leads = ids.length
    ? await Lead.find({ _id: { $in: ids }, dealer_id: String(dealerId) }).select("assigned_to").lean() : [];
  return filterRowsToAssigned(rows, leads, userId);
}

// Who did it, for the AI service's audit fields ("closed_by", "handled by").
export async function staffName(user) {
  const full = await User.findById(user._id).select("name email").lean();
  return full?.name || full?.email || String(user._id);
}

// Server-side call to the AI service (base UPSELL_AGENT_API_URL, shared secret,
// as app/lib/upsellAgentClient.js). Never throws: an unreachable service comes
// back as { ok: false, status: 0 } so each route can answer plainly.
export async function callAiService(path, { method = "GET", query, body } = {}) {
  const base = (process.env.UPSELL_AGENT_API_URL || "http://localhost:8100").replace(/\/$/, "");
  const secret = process.env.UPSELL_SERVICE_SHARED_SECRET;
  if (!secret) return { ok: false, status: 0, body: { detail: "UPSELL_SERVICE_SHARED_SECRET is not set" } };
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null))}` : "";
  try {
    const res = await fetch(`${base}${path}${qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: data };
  } catch (error) {
    return { ok: false, status: 0, body: { detail: error?.message } };
  }
}

// An AI service failure as the staff screens show it.
export function aiServiceError(result, notFoundMessage = "Not found") {
  if (result.status === 404) return jsonError(notFoundMessage, 404);
  if (result.status === 0) {
    return jsonError("The AI service can't be reached right now. Please try again in a minute.", 502,
      { detail: result.body?.detail });
  }
  return jsonError("The AI service returned an error.", 502, { status: result.status, detail: result.body?.detail });
}

// Name, phone and vehicle for each lead id, from the CRM's own leads.
export async function leadSummaries(dealerId, leadIds) {
  const ids = [...new Set(leadIds.filter((id) => mongoose.isValidObjectId(id)))];
  if (!ids.length) return {};
  const leads = await Lead.find({ _id: { $in: ids }, dealer_id: String(dealerId) })
    .select("name phone email vehicle_year vehicle_make vehicle_model fe_lead_status assigned_to")
    .lean();
  return Object.fromEntries(leads.map((lead) => [String(lead._id), {
    name: lead.name || null,
    phone: lead.phone || null,
    email: lead.email || null,
    vehicle: [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ") || null,
    crm_status: lead.fe_lead_status || null,
  }]));
}
