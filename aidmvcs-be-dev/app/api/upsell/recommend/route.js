import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import { resolveRequestAuthorization } from "@lib/apiAuth";
import { isAuthorizedForDealer } from "@lib/customerListing";
import { getUpsellRecommendation } from "@lib/upsellAgentClient";

function jsonError(message, status) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Dealer-portal-facing endpoint. CORRECTION from an earlier version of this
 * file: /api/* is NOT covered by middleware.js's matcher (which only lists
 * /agency* and /dealer* page paths - see middleware.js), so this route had NO
 * auth of its own. Fixed here to require a real dealer/agency/admin session,
 * using the same Bearer-JWT + isAuthorizedForDealer check
 * app/api/customers/[id]/360/route.js already uses - dealer_id in the request
 * body is verified against the caller's actual session, not trusted at face
 * value.
 *
 * This route is the ONLY point where a human session is checked in this whole
 * chain - the dealer_id it forwards to the Python service (and that the
 * service later presents back to /api/customers/[id]/360 as a trusted
 * internal caller) has already been authorized right here. See
 * ../../../../agentic-upsell/INTEGRATION.md for the full chain.
 */
export async function POST(req) {
  try {
    await dbConnect();
    const auth = await resolveRequestAuthorization(req);
    if (!auth) return jsonError("Unauthorized", 401);

    const body = await req.json();
    const { dealer_id, customer_id, lead_id, trigger } = body || {};

    if (!dealer_id || !customer_id || !trigger) {
      return jsonError("dealer_id, customer_id and trigger are required", 400);
    }

    // This route is meant to be called by a logged-in dealer/agency/admin
    // user, not by another internal service - if a request somehow arrives
    // with a valid internal-service token instead, treat it as unauthorized
    // rather than silently trusting it, since that's not this route's
    // contract.
    if (auth.mode !== "user") return jsonError("Unauthorized", 401);
    if (!(await isAuthorizedForDealer(auth.currentUser, dealer_id))) {
      return jsonError("Forbidden", 403);
    }

    const result = await getUpsellRecommendation({
      dealerId: dealer_id,
      customerId: customer_id,
      leadId: lead_id,
      trigger,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error calling upsell agent:", error);
    return jsonError(error.message || "Failed to get upsell recommendation", 500);
  }
}
