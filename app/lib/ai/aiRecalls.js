// Staff confirming or closing an NHTSA recall for a delivered vehicle (agentic-upsell PLAN_4 stream X2, audit 3).
//
// The AI only messages a customer about a recall NHTSA lists for the VIN itself; a recall NHTSA lists for the
// model ("unverified") waits for staff to confirm it for this VIN (SOLD-DELIVERED PDF §6). The AI service has the
// endpoints (POST /v1/vehicles/{vin}/recalls/{id}/confirm | /close); this is the CRM side: which VINs a lead's
// AI panel may act on, and the request each button sends. Pure, so the CRM's node tests cover it.

export const RECALL_ACTIONS = Object.freeze(['confirm', 'close']);
export const RECALL_CLOSE_REASONS = Object.freeze(['completed', 'not_applicable']);
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const RECALL_ID = /^[A-Z0-9-]{3,20}$/;

// The VINs of the vehicles the AI tracks for this lead (its profile's ownership records).
export function leadVins(profile) {
  const vehicles = profile?.ownership?.vehicles;
  if (!Array.isArray(vehicles)) return [];
  return [...new Set(vehicles.map((v) => String(v?.vin || '').toUpperCase()).filter((v) => VIN.test(v)))];
}

// { path, body } for the AI service, or { error, status }. `vins`: the lead's own VINs (nothing else is accepted).
export function recallRequest(input, { dealerId, by, vins }) {
  const action = input?.action;
  if (!RECALL_ACTIONS.includes(action)) return { error: 'action must be "confirm" or "close"', status: 400 };
  const vin = String(input?.vin || '').toUpperCase();
  if (!VIN.test(vin)) return { error: 'A 17-character VIN is required', status: 400 };
  if (!(vins || []).includes(vin)) return { error: "That VIN isn't a vehicle on this lead", status: 403 };
  const recallId = String(input?.recall_id || '').toUpperCase();
  if (!RECALL_ID.test(recallId)) return { error: 'A recall campaign number is required', status: 400 };
  const note = typeof input?.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : undefined;
  const body = { dealer_id: String(dealerId), by: by || undefined, note };
  if (action === 'close') {
    if (!RECALL_CLOSE_REASONS.includes(input?.reason)) {
      return { error: 'reason must be "completed" or "not_applicable"', status: 400 };
    }
    body.reason = input.reason;
  }
  return { path: `/v1/vehicles/${vin}/recalls/${encodeURIComponent(recallId)}/${action}`, body };
}
