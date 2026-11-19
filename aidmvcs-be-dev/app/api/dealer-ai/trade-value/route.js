// "Get value" on a customer's trade-in (Betsy, 19 Nov 2026: trade values from Vehicle Databases for dealers whose
// super admin chose "AutoPulse value"; lib/tradeValueSource.js).
//   GET  ?dealer_id=                  -> { source: "dealer_link" | "autopulse" }   (whether to show the button)
//   POST { trade_in_id, dealer_id? }  -> the AI service's estimate (agentic-upsell api/trade_values.py): values by
//                                        trim and condition for the trade-in's VIN (else year / make / model), its
//                                        miles and the dealership's state. Read-only: the trade-in isn't changed.
// The dealership's staff only. Answers 409 when the dealer uses its own link, 422 when the trade-in lacks what is
// needed, 503 while Vehicle Databases has no key.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import TradeIn from "@models/TradeIn";
import User from "@models/User";
import { stateCode, tradeValueSource } from "@lib/tradeValueSource";
import { callAiService, jsonError, requireDealerSession } from "../_lib/dealerAi";

export const dynamic = "force-dynamic";

const loadDealer = (dealerId) => User.findOne({ _id: dealerId, type: "dealer" }).select("dealer_account_information").lean();

export async function GET(req) {
  const session = await requireDealerSession(req, new URL(req.url).searchParams.get("dealer_id"));
  if (session.error) return session.error;
  return NextResponse.json({ source: tradeValueSource(await loadDealer(session.dealerId)) });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const session = await requireDealerSession(req, body?.dealer_id);
  if (session.error) return session.error;
  const dealer = await loadDealer(session.dealerId);
  if (tradeValueSource(dealer) !== "autopulse") {
    return jsonError("This dealership gives trade values through its own link (AI Settings > Trade-in values).", 409);
  }
  if (!mongoose.isValidObjectId(body?.trade_in_id)) return jsonError("trade_in_id is required", 400);
  const trade = await TradeIn.findOne({ _id: body.trade_in_id, dealer_id: session.dealerId })
    .select("vin year make model miles").lean();
  if (!trade) return jsonError("Trade-in not found", 404);
  if (trade.miles == null) return jsonError("Add the trade-in's miles first.", 422);
  if (!trade.vin && !(trade.year && trade.make && trade.model)) {
    return jsonError("Add the trade-in's VIN, or its year, make and model, first.", 422);
  }
  const state = stateCode(dealer?.dealer_account_information?.store_state);
  if (!state) return jsonError("The dealership's state isn't set (Dealer Setup > State).", 422);

  const result = await callAiService("/v1/trade-values/estimate", { method: "POST", body: {
    dealer_id: session.dealerId, mileage: trade.miles, state,
    ...(trade.vin && trade.vin.length === 17 ? { vin: trade.vin } : { year: trade.year, make: trade.make, model: trade.model }),
  } });
  if (result.status === 503) return jsonError("Trade values aren't switched on yet (Vehicle Databases has no key).", 503);
  if (result.status === 422) return jsonError(result.body?.detail || "Vehicle Databases can't value this vehicle as entered.", 422);
  if (!result.ok) return jsonError("Vehicle Databases couldn't be reached. Try again in a minute.", 502);
  return NextResponse.json(result.body);
}
