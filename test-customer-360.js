import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLooseDate,
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
} from "./app/api/customers/[id]/360/assemble.js";

test("parseLooseDate accepts DealerVault's M/D/YYYY strings and rejects garbage", () => {
  assert.equal(parseLooseDate("9/8/2026").getFullYear(), 2026);
  assert.equal(parseLooseDate(null), null);
  assert.equal(parseLooseDate(""), null);
  assert.equal(parseLooseDate("not a date"), null);
});

test("getDealDate reads Contract Date, not Delivery Date", () => {
  const deal = { "Contract Date": "9/8/2026", "Delivery Date": "9/20/2026" };
  assert.equal(getDealDate(deal).getMonth(), 8); // September
  assert.equal(getDealDate(deal).getDate(), 8);
  assert.equal(getDealDate({}), null);
});

test("getDealPrice parses comma-formatted amounts", () => {
  assert.equal(getDealPrice({ "Sales Price": "24,500.00" }), 24500);
  assert.equal(getDealPrice({ "Sales Price": null }), null);
  assert.equal(getDealPrice({}), null);
});

test("getDealSalesperson joins distinct split-deal salesmen and dedupes repeats", () => {
  assert.equal(
    getDealSalesperson({ "Salesman 1 Name": "Alex Rivera", "Salesman 2 Name": "Jamie Lee" }),
    "Alex Rivera / Jamie Lee"
  );
  assert.equal(
    getDealSalesperson({ "Salesman 1 Name": "Alex Rivera", "Salesman 2 Name": "Alex Rivera" }),
    "Alex Rivera"
  );
  assert.equal(getDealSalesperson({}), null);
});

test("getRepairOrderDate prefers Close Date and falls back to Open Date for still-open ROs", () => {
  assert.equal(getRepairOrderDate({ "Open Date": "9/1/2026", "Close Date": "9/3/2026" }).getDate(), 3);
  assert.equal(getRepairOrderDate({ "Open Date": "9/1/2026" }).getDate(), 1);
  assert.equal(getRepairOrderDate({}), null);
});

test("getRepairOrderTotals returns both pay-type totals, never collapsed to one", () => {
  assert.deepEqual(
    getRepairOrderTotals({ "Total Sale": "500.00", "Customer Total Sale": "150.00" }),
    { total_sale: 500, customer_total_sale: 150 }
  );
  assert.deepEqual(getRepairOrderTotals({}), { total_sale: null, customer_total_sale: null });
});

test("getAppointmentDate combines separate date and time fields", () => {
  const withAmPm = getAppointmentDate({ "Appointment Date": "9/10/2026", "Appointment Time": "8:30 AM" });
  assert.equal(withAmPm.getHours(), 8);
  assert.equal(withAmPm.getMinutes(), 30);

  const twentyFourHour = getAppointmentDate({ "Appointment Date": "9/10/2026", "Appointment Time": "08:30" });
  assert.equal(twentyFourHour.getHours(), 8);

  const pm = getAppointmentDate({ "Appointment Date": "9/10/2026", "Appointment Time": "1:15 PM" });
  assert.equal(pm.getHours(), 13);

  // Unparseable time still yields a midnight-anchored date, not a dropped appointment.
  const noUsableTime = getAppointmentDate({ "Appointment Date": "9/10/2026", "Appointment Time": "garbage" });
  assert.equal(noUsableTime.getHours(), 0);

  // Deliberately calendar-invalid fixture used by the ingestion tests; must not throw.
  assert.doesNotThrow(() => getAppointmentDate({ "Appointment Date": "2/30/2026", "Appointment Time": "8:30 AM" }));
});

test("dedupeServiceTimeline suppresses an appointment once it has converted to an RO", () => {
  const repairOrders = [{ ro_number: "RO-1" }];
  const appointments = [
    { appointment_number: "A-1", ro_number: "RO-1" }, // converted - suppress
    { appointment_number: "A-2", ro_number: null }, // still just an appointment - keep
    { appointment_number: "A-3", ro_number: "RO-999" }, // converted to an RO not in this set - keep
  ];
  const result = dedupeServiceTimeline(repairOrders, appointments);
  assert.equal(result.repairOrders.length, 1);
  assert.deepEqual(
    result.appointments.map((a) => a.appointment_number),
    ["A-2", "A-3"]
  );
});

test("deriveVehicleOwners resolves the most recent record across Deal/RO/Appointment, not Deal alone", () => {
  const owners = deriveVehicleOwners({
    deals: [{ vin: "VIN1", customer_id: "cust-A", "Contract Date": "1/1/2026" }],
    repairOrders: [{ vin: "VIN1", customer_id: "cust-B", "Close Date": "6/1/2026" }],
    appointments: [],
  });
  // RO is more recent than the deal, so ownership follows the RO's customer.
  assert.equal(owners.get("VIN1").customer_id, "cust-B");
});

test("deriveVehicleOwners still resolves an owner for a VIN with no Deal at all", () => {
  const owners = deriveVehicleOwners({
    deals: [],
    repairOrders: [{ vin: "VIN2", customer_id: "cust-C", "Close Date": "6/1/2026" }],
    appointments: [],
  });
  assert.equal(owners.get("VIN2").customer_id, "cust-C");
});

test("deriveVehicleOwners keeps an undated record's customer rather than dropping it", () => {
  const owners = deriveVehicleOwners({
    deals: [],
    repairOrders: [{ vin: "VIN3", customer_id: "cust-D" }], // no Open/Close Date at all
    appointments: [],
  });
  assert.equal(owners.get("VIN3").customer_id, "cust-D");
});

test("buildOverviewFeed sorts most-recent-first and pushes undated records last", () => {
  const feed = buildOverviewFeed({
    leads: [{ createdAt: "2026-01-01T00:00:00Z" }],
    deals: [{ "Contract Date": "9/1/2026" }],
    repairOrders: [{}], // undated
    appointments: [{ "Appointment Date": "3/1/2026", "Appointment Time": "9:00 AM" }],
  });
  assert.deepEqual(feed.map((entry) => entry.type), ["deal", "appointment", "lead", "repair_order"]);
});

test("buildValueSnapshot sums deal price and both RO totals, and finds last activity", () => {
  const snapshot = buildValueSnapshot({
    leads: [],
    deals: [{ "Sales Price": "20,000" }, { "Sales Price": "5,000" }],
    repairOrders: [{ "Total Sale": "500", "Customer Total Sale": "100", "Close Date": "9/9/2026" }],
    appointments: [],
  });
  assert.equal(snapshot.total_deal_price, 25000);
  assert.equal(snapshot.total_repair_order_sale, 500);
  assert.equal(snapshot.total_repair_order_customer_sale, 100);
  assert.equal(snapshot.last_activity_at.getDate(), 9);
});

test("getOriginBadge covers all four dealervault_upload/inbound_lead combinations", () => {
  assert.equal(getOriginBadge({ dealervault_upload: false, inbound_lead: true }), "Inbound Lead");
  assert.equal(getOriginBadge({ dealervault_upload: true, inbound_lead: false }), "DealerVault");
  assert.equal(getOriginBadge({ dealervault_upload: true, inbound_lead: true }), "Inbound & DealerVault");
  assert.equal(getOriginBadge({ dealervault_upload: false, inbound_lead: false }), "Unknown");
  assert.equal(getOriginBadge({}), "Unknown");
});
