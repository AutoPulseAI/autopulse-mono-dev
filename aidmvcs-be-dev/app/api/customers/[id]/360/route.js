import { NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
import Lead from "@models/Lead";
import Deal from "@models/Deal";
import RepairOrder from "@models/RepairOrder";
import ServiceAppointment from "@models/ServiceAppointment";
import Vehicle from "@models/Vehicle";
import TradeIn from "@models/TradeIn";
import ActivityLog from "@models/ActivityLog";
import { buildActivity } from "./activity";
import { isAuthorizedForDealer } from "@lib/customerListing";
import { resolveRequestAuthorization } from "@lib/apiAuth";
import {
  getDealDate,
  getDealPrice,
  getDealSalesperson,
  getRepairOrderDate,
  getRepairOrderTotals,
  getAppointmentDate,
  dedupeServiceTimeline,
  deriveVehicleOwners,
  buildOverviewFeed,
  buildValueSnapshot,
  getOriginBadge,
} from "./assemble.js";

// Caps how many of this customer's own records feed the Overview feed / value
// snapshot. Not full history pagination (there is none on this endpoint,
// per spec §5) - just a sane ceiling for a single dealer-customer relationship.
const RECORD_LIMIT = 500;

function jsonError(message, status) {
  return NextResponse.json({ message }, { status });
}

function uniqueVins(...recordLists) {
  const vins = recordLists.flatMap((records) => records.map((record) => record.vin));
  return [...new Set(vins.filter(Boolean))];
}

// Current owner of each referenced VIN is resolved dealer-wide (not scoped to
// this customer), so a VIN that has changed hands or was only ever serviced
// here (never sold here) still resolves correctly. See assemble.js
// deriveVehicleOwners for why this can't be limited to this customer's deals.
async function loadVehicleOwnership(dealerId, vins) {
  if (!vins.length) return new Map();
  const [deals, repairOrders, appointments] = await Promise.all([
    Deal.find({ dealer_id: dealerId, vin: { $in: vins } })
      .select({ vin: 1, customer_id: 1, "Contract Date": 1 })
      .lean(),
    RepairOrder.find({ dealer_id: dealerId, vin: { $in: vins } })
      .select({ vin: 1, customer_id: 1, "Open Date": 1, "Close Date": 1 })
      .lean(),
    ServiceAppointment.find({ dealer_id: dealerId, vin: { $in: vins } })
      .select({ vin: 1, customer_id: 1, "Appointment Date": 1, "Appointment Time": 1 })
      .lean(),
  ]);
  return deriveVehicleOwners({ deals, repairOrders, appointments });
}

function hydrateVehicle(vin, vehicleDoc, fallbackSource) {
  return {
    vin,
    year: vehicleDoc?.year ?? fallbackSource?.["Year"] ?? null,
    make: vehicleDoc?.make ?? fallbackSource?.["Make"] ?? null,
    model: vehicleDoc?.model ?? fallbackSource?.["Model"] ?? null,
    // No inventory record exists for every VIN a customer's history touches
    // (e.g. a trade-in or a vehicle bought elsewhere and only serviced here) -
    // vehicle_id is null in that case rather than treated as an error.
    vehicle_id: vehicleDoc?._id ?? null,
  };
}

export async function GET(req, { params }) {
  try {
    await dbConnect();
    const auth = await resolveRequestAuthorization(req);
    if (!auth) return jsonError("Unauthorized", 401);

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return jsonError("Invalid customer id", 400);

    const url = new URL(req.url);
    const dealerId = url.searchParams.get("dealer_id")?.trim();
    if (!dealerId) return jsonError("dealer_id is required", 400);

    // A trusted internal service (see ../../../../agentic-upsell/INTEGRATION.md) is
    // authorized by possession of the shared secret, not by a human user's dealer
    // relationship - it has no `currentUser` to check isAuthorizedForDealer against,
    // and the dealer_id it presents was already verified against a real dealer
    // session one hop earlier, in POST /api/upsell/recommend.
    if (auth.mode === "user" && !(await isAuthorizedForDealer(auth.currentUser, dealerId))) {
      return jsonError("Forbidden", 403);
    }

    const customer = await Customer.findOne({ _id: id, dealer_id: dealerId }).lean();
    if (!customer) return jsonError("Customer not found", 404);

    const [leads, deals, repairOrdersRaw, appointmentsRaw, tradeIns] = await Promise.all([
      Lead.find({ customer_id: customer._id, dealer_id: dealerId })
        .sort({ createdAt: -1 })
        .limit(RECORD_LIMIT)
        .lean(),
      Deal.find({ dealer_id: dealerId, customer_id: customer._id }).limit(RECORD_LIMIT).lean(),
      RepairOrder.find({ dealer_id: dealerId, customer_id: customer._id }).limit(RECORD_LIMIT).lean(),
      ServiceAppointment.find({ dealer_id: dealerId, customer_id: customer._id }).limit(RECORD_LIMIT).lean(),
      // Trade-ins the customer has brought to this dealer (manual or from ADF
      // leads). Added for the AI service's slot pre-fill (agentic-upsell
      // MASTER_PLAN_1 Stage 6); newest first, like leads.
      TradeIn.find({ dealer_id: dealerId, customer_id: customer._id })
        .sort({ createdAt: -1 })
        .limit(RECORD_LIMIT)
        .lean(),
    ]);

    const { repairOrders, appointments } = dedupeServiceTimeline(repairOrdersRaw, appointmentsRaw);

    const vins = uniqueVins(deals, repairOrdersRaw, appointmentsRaw);
    const [vehicleDocs, ownerByVin] = await Promise.all([
      vins.length ? Vehicle.find({ dealerId, vin: { $in: vins } }).lean() : [],
      loadVehicleOwnership(dealerId, vins),
    ]);
    const vehicleDocByVin = new Map(vehicleDocs.map((doc) => [doc.vin, doc]));
    // Prefer a fallback record with real Year/Make/Model when no inventory
    // Vehicle document exists for this VIN.
    const fallbackByVin = new Map(
      [...deals, ...repairOrdersRaw, ...appointmentsRaw]
        .filter((record) => record.vin && (record["Year"] || record["Make"] || record["Model"]))
        .map((record) => [record.vin, record])
    );
    const vehicles = vins.map((vin) => ({
      ...hydrateVehicle(vin, vehicleDocByVin.get(vin), fallbackByVin.get(vin)),
      current_owner_customer_id: ownerByVin.get(vin)?.customer_id ?? null,
      is_current_owner: String(ownerByVin.get(vin)?.customer_id ?? "") === String(customer._id),
    }));

    const overviewFeed = buildOverviewFeed({
      leads,
      deals,
      repairOrders,
      appointments,
      assignments: customer.assignment_history,
    });
    const valueSnapshot = buildValueSnapshot({ leads, deals, repairOrders, appointments });
    // Client, 10 Oct 2026: every staff and AI action on the timeline. Kept apart from `overview`, which the AI
    // service also reads, so its contract doesn't change; the customer page shows both together.
    let activity = [];
    try {
      activity = await buildActivity({ dealerId, customerId: customer._id, leadIds: leads.map((l) => l._id) }, { ActivityLog });
    } catch (error) {
      console.error("[activity] timeline build failed", { customer_id: String(customer._id), error: error?.message });
    }

    return NextResponse.json({
      data: {
        customer: { ...customer, origin_badge: getOriginBadge(customer, { hasLinkedLeads: leads.length > 0 }) },
        value_snapshot: valueSnapshot,
        overview: overviewFeed,
        activity,
        leads,
        deals: deals.map((deal) => ({
          ...deal,
          computed_date: getDealDate(deal),
          computed_price: getDealPrice(deal),
          computed_salesperson: getDealSalesperson(deal),
        })),
        repair_orders: repairOrders.map((ro) => ({
          ...ro,
          computed_date: getRepairOrderDate(ro),
          computed_totals: getRepairOrderTotals(ro),
        })),
        appointments: appointments.map((appointment) => ({
          ...appointment,
          computed_date: getAppointmentDate(appointment),
        })),
        // Full appointment history for the Appointments tab - unlike
        // `appointments` above, not de-duplicated against converted repair
        // orders, since a converted appointment is still one the customer had.
        all_appointments: appointmentsRaw.map((appointment) => ({
          ...appointment,
          computed_date: getAppointmentDate(appointment),
        })),
        vehicles,
        trade_ins: tradeIns,
      },
    });
  } catch (error) {
    console.error("Customer 360 fetch failed:", error);
    return jsonError("Internal server error", 500);
  }
}
