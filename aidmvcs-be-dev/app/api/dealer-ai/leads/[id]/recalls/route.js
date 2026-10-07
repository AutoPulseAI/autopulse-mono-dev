// Recalls for the vehicles on a lead, and staff confirming / closing one (agentic-upsell PLAN_4 stream X2).
//   GET  /api/dealer-ai/leads/<leadId>/recalls
//        -> { vehicles: [{ vin, label, recalls: [...] }] }  (the AI service's recall records per VIN)
//   POST /api/dealer-ai/leads/<leadId>/recalls
//        { vin, recall_id, action: "confirm" | "close", reason?: "completed" | "not_applicable", note? }
// "Confirm" tells the AI NHTSA's recall applies to this VIN, so the customer can be told (SOLD-DELIVERED PDF §6);
// "Close" ends it (repaired, or not applicable). Only a VIN on this lead's own ownership records is accepted.

import { NextResponse } from "next/server";
import { leadVins, recallRequest } from "@lib/ai/aiRecalls";
import { aiServiceError, callAiService, jsonError, requireLeadAccess, staffName } from "../../../_lib/dealerAi";

async function vehiclesOf(leadId, dealerId) {
  const profile = await callAiService(`/v1/leads/${leadId}/profile`, { query: { dealer_id: dealerId } });
  if (!profile.ok) return { error: profile };
  const vehicles = profile.body?.ownership?.vehicles || [];
  return { vins: leadVins(profile.body), vehicles };
}

export async function GET(req, { params }) {
  const access = await requireLeadAccess(req, params);
  if (access.error) return access.error;
  const { leadId, dealerId } = access;
  const found = await vehiclesOf(leadId, dealerId);
  if (found.error) return aiServiceError(found.error, "The AI hasn't worked this lead.");
  const vehicles = await Promise.all(found.vins.map(async (vin) => {
    const record = found.vehicles.find((v) => String(v?.vin || "").toUpperCase() === vin) || {};
    const recalls = await callAiService(`/v1/vehicles/${vin}/recalls`, { query: { dealer_id: dealerId } });
    return {
      vin,
      label: [record.year, record.make, record.model].filter(Boolean).join(" ") || null,
      recalls: recalls.ok && Array.isArray(recalls.body) ? recalls.body : [],
      watched: recalls.ok,
    };
  }));
  return NextResponse.json({ lead_id: leadId, vehicles });
}

export async function POST(req, { params }) {
  const access = await requireLeadAccess(req, params);
  if (access.error) return access.error;
  const { leadId, dealerId, user } = access;
  let input;
  try {
    input = await req.json();
  } catch {
    return jsonError("Body must be JSON", 400);
  }
  const found = await vehiclesOf(leadId, dealerId);
  if (found.error) return aiServiceError(found.error, "The AI hasn't worked this lead.");
  const built = recallRequest(input, { dealerId, by: await staffName(user), vins: found.vins });
  if (built.error) return jsonError(built.error, built.status);
  const result = await callAiService(built.path, { method: "POST", body: built.body });
  if (!result.ok) return aiServiceError(result, "That recall was not found for this vehicle.");
  return NextResponse.json(result.body);
}
