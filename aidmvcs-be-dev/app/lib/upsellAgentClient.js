/**
 * Server-side client for the agentic-upsell Python service (../../agentic-upsell/).
 * Mirrors the existing pattern for calling n8n (see app/worker/emailWorker.js's
 * callOllama(), app/lib/serverTranslateOutgoing.js) so this fits the codebase's
 * established shape rather than inventing a new one.
 *
 * Called ONLY from server-side code (app/api/upsell/recommend/route.js) —
 * never from a client component. The browser talks to our own /api/upsell/*
 * routes, which enforce a real dealer session (see app/lib/apiAuth.js) before
 * forwarding here. See ../../agentic-upsell/INTEGRATION.md for the full chain,
 * including how the Python service authenticates its own follow-up call back
 * into this app (app/lib/internalServiceAuth.js).
 */

function getUpsellAgentUrl() {
  const base = (process.env.UPSELL_AGENT_API_URL || "http://localhost:8100").replace(/\/$/, "");
  return base;
}

function getSharedSecret() {
  const secret = process.env.UPSELL_SERVICE_SHARED_SECRET;
  if (!secret) {
    // Fail loudly rather than silently sending an unauthenticated request -
    // the Python service is expected to reject that anyway (see
    // agentic-upsell/src/upsell_agent/api/auth.py), but failing here gives a
    // much clearer error than a downstream 401 would.
    throw new Error(
      "UPSELL_SERVICE_SHARED_SECRET is not configured - see agentic-upsell/INTEGRATION.md"
    );
  }
  return secret;
}

/**
 * @param {object} opts
 * @param {string} opts.dealerId
 * @param {string} opts.customerId
 * @param {string} [opts.leadId]
 * @param {string} opts.trigger - e.g. 'appointment_booked', 'service_visit_closed', 'scheduled_review'
 * @returns {Promise<{recommendations: object[], suppressed_reason: string|null}>}
 */
export async function getUpsellRecommendation({ dealerId, customerId, leadId, trigger }) {
  const url = `${getUpsellAgentUrl()}/upsell/recommend`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSharedSecret()}`,
    },
    body: JSON.stringify({
      dealer_id: dealerId,
      customer_id: customerId,
      lead_id: leadId || null,
      trigger,
    }),
  });

  if (!res.ok) {
    throw new Error(`Upsell agent request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
