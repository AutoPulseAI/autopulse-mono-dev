import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Customer from "./app/models/Customer.js";
import Lead from "./app/models/Lead.js";
import {
  normalizeEmail,
  normalizePhone,
  isEmailSentinel,
  finalizeCustomerIdentity,
  resolveCustomerForLead,
} from "./app/lib/customerResolver.js";

test("Customer and Lead schemas expose the required fields and indexes", () => {
  assert.equal(Customer.schema.path("dealer_id").options.required, true);
  assert.equal(Customer.schema.path("dealer_id").instance, "String");
  assert.equal(Customer.schema.path("identity_confidence"), undefined);
  assert.equal(Customer.schema.path("dealervault_upload").defaultValue, false);
  assert.equal(Customer.schema.path("inbound_lead").defaultValue, false);
  assert.equal(Customer.schema.path("phones").schema.path("sms_opt_in").defaultValue, undefined);
  assert.deepEqual(Customer.schema.path("emails").schema.path("first_seen_lead_id").options.ref, "Lead");
  assert.deepEqual(Customer.schema.path("phones").schema.path("first_seen_lead_id").options.ref, "Lead");

  const customerIndexes = Customer.schema.indexes().map(([fields]) => fields);
  assert.ok(customerIndexes.some((index) => index.dealer_id === 1 && index["emails.value"] === 1));
  assert.ok(customerIndexes.some((index) => index.dealer_id === 1 && index["phones.value"] === 1));

  assert.equal(Lead.schema.path("customer_id").instance, "ObjectId");
  assert.equal(Lead.schema.path("customer_id").options.ref, "Customer");
  assert.equal(Lead.schema.path("customer_id").defaultValue, null);

  const leadIndexes = Lead.schema.indexes().map(([fields]) => fields);
  assert.ok(leadIndexes.some((index) => index.dealer_id === 1 && index.customer_id === 1));
});

test("identifiers are normalized to a stable cross-channel key", () => {
  assert.equal(normalizeEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normalizePhone(" +91 (98765) 43210 "), "919876543210");
  assert.equal(normalizePhone("(415) 555-1212"), "4155551212");

  // The same US number must normalize identically whether it arrives with
  // an explicit '+1' (e.g. Twilio's E.164 'From') or as bare local digits
  // (e.g. LLM-extracted from message text) — otherwise the same customer
  // texting and emailing gets resolved to two different Customer docs.
  assert.equal(normalizePhone("+14155551212"), normalizePhone("4155551212"));
  assert.equal(normalizePhone("+1 (415) 555-1212"), "4155551212");
});

test("normalizeEmail rejects AI-extraction sentinel placeholders", () => {
  assert.equal(normalizeEmail("NA"), null);
  assert.equal(normalizeEmail("n/a"), null);
  assert.equal(normalizeEmail("null"), null);
  assert.equal(normalizeEmail("undefined"), null);
  assert.equal(normalizeEmail("person@example.com"), "person@example.com");
});

test("new Customer identifiers defer first_seen_lead_id until finalization", async () => {
  const originalFindOne = Customer.findOne;
  const originalSave = Customer.prototype.save;
  const leadId = new mongoose.Types.ObjectId();
  let savedCustomer;

  try {
    Customer.findOne = async () => null;
    Customer.prototype.save = async function save() {
      savedCustomer = this;
      return this;
    };

    const resolution = await resolveCustomerForLead({
      dealerId: "dealer-1",
      name: "Person",
      email: "Person@Example.COM",
      phone: "+1 (415) 555-1212",
      source: "test",
      leadId,
    });

    assert.ok(resolution.customerId);
    assert.deepEqual(resolution.introducedEmails, ["person@example.com"]);
    assert.deepEqual(resolution.introducedPhones, ["4155551212"]);
    assert.equal(resolution.resolutionSucceeded, true);
    assert.equal(savedCustomer.emails[0].value, "person@example.com");
    assert.equal(savedCustomer.emails[0].first_seen_lead_id, undefined);
    assert.equal(savedCustomer.phones[0].value, "4155551212");
    assert.equal(savedCustomer.phones[0].first_seen_lead_id, undefined);
    assert.equal(savedCustomer.phones[0].sms_opt_in, undefined);
    assert.equal(savedCustomer.inbound_lead, true);
    assert.equal(savedCustomer.dealervault_upload, false);
  } finally {
    Customer.findOne = originalFindOne;
    Customer.prototype.save = originalSave;
  }
});

test("smsOptIn is recorded on a newly created phone identifier when passed", async () => {
  const originalFindOne = Customer.findOne;
  const originalSave = Customer.prototype.save;
  let savedCustomer;

  try {
    Customer.findOne = async () => null;
    Customer.prototype.save = async function save() {
      savedCustomer = this;
      return this;
    };

    await resolveCustomerForLead({
      dealerId: "dealer-1",
      name: "Person",
      phone: "4155551212",
      source: "sms",
      leadId: new mongoose.Types.ObjectId(),
      smsOptIn: true,
    });

    assert.equal(savedCustomer.phones[0].sms_opt_in, true);
  } finally {
    Customer.findOne = originalFindOne;
    Customer.prototype.save = originalSave;
  }
});

test("smsOptIn updates an already-existing phone on the matched Customer", async () => {
  const originalFindOne = Customer.findOne;
  const originalUpdateOne = Customer.updateOne;
  const customer = { _id: new mongoose.Types.ObjectId() };
  const updateCalls = [];

  try {
    Customer.findOne = async (query) => (query["phones.value"] ? customer : null);
    Customer.updateOne = async (query, update) => {
      updateCalls.push({ query, update });
      // The $push attempt never matches because the phone already exists.
      if (update.$push) return { matchedCount: 0, modifiedCount: 0 };
      // The sms_opt_in $set attempt matches the existing phone entry.
      return { matchedCount: 1, modifiedCount: 1 };
    };

    const result = await resolveCustomerForLead({
      dealerId: "dealer-1",
      phone: "4155551212",
      source: "sms",
      leadId: new mongoose.Types.ObjectId(),
      smsOptIn: true,
    });

    assert.deepEqual(result.customerId, customer._id);
    assert.deepEqual(result.introducedPhones, []); // not a newly introduced identifier
    assert.equal(updateCalls.length, 3);
    assert.ok(updateCalls.some(({ update }) => update.$set?.inbound_lead === true));
    assert.ok(updateCalls.some(({ update }) => update.$set?.["phones.$.sms_opt_in"] === true));
  } finally {
    Customer.findOne = originalFindOne;
    Customer.updateOne = originalUpdateOne;
  }
});

test("isEmailSentinel flags AI-extraction placeholders without touching real emails", () => {
  assert.equal(isEmailSentinel("NA"), true);
  assert.equal(isEmailSentinel("null"), true);
  assert.equal(isEmailSentinel("person@example.com"), false);
  assert.equal(isEmailSentinel(undefined), false);
});

test("email and phone matches from different Customers leave the Lead unresolved", async () => {
  const originalFindOne = Customer.findOne;
  const emailCustomer = { _id: new mongoose.Types.ObjectId() };
  const phoneCustomer = { _id: new mongoose.Types.ObjectId() };

  try {
    Customer.findOne = async (query) =>
      query["emails.value"] ? emailCustomer : phoneCustomer;

    const result = await resolveCustomerForLead({
      dealerId: "dealer-1",
      email: "person@example.com",
      phone: "4155551212",
      source: "test",
      leadId: new mongoose.Types.ObjectId(),
    });

    assert.equal(result.customerId, null);
    assert.equal(result.resolutionSucceeded, false);
    assert.deepEqual(result.introducedEmails, []);
    assert.deepEqual(result.introducedPhones, []);
  } finally {
    Customer.findOne = originalFindOne;
  }
});

test("conditional enrichment treats matchedCount zero as a no-op", async () => {
  const originalFindOne = Customer.findOne;
  const originalUpdateOne = Customer.updateOne;
  const customer = { _id: new mongoose.Types.ObjectId() };
  let updateCount = 0;

  try {
    Customer.findOne = async (query) =>
      query["emails.value"] ? customer : null;
    Customer.updateOne = async () => {
      updateCount += 1;
      return { matchedCount: 0, modifiedCount: 0 };
    };

    const result = await resolveCustomerForLead({
      dealerId: "dealer-1",
      email: "person@example.com",
      source: "test",
      leadId: new mongoose.Types.ObjectId(),
    });

    assert.deepEqual(result.customerId, customer._id);
    assert.deepEqual(result.introducedEmails, []);
    assert.equal(updateCount, 2);
  } finally {
    Customer.findOne = originalFindOne;
    Customer.updateOne = originalUpdateOne;
  }
});

test("DealerVault-only Customer requires both contacts before an inbound Lead joins it", async () => {
  const originalFindOne = Customer.findOne;
  const originalUpdateOne = Customer.updateOne;
  const originalSave = Customer.prototype.save;
  const existing = {
    _id: new mongoose.Types.ObjectId(),
    dealervault_upload: true,
    inbound_lead: false,
  };
  const updates = [];
  let savedCustomer;

  try {
    Customer.findOne = async ({ "emails.value": email, "phones.value": phone }) =>
      email === "both@example.com" || phone === "4155551212" ? existing : null;
    Customer.updateOne = async (filter, update) => {
      updates.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    };
    Customer.prototype.save = async function save() {
      savedCustomer = this;
      return this;
    };

    const joined = await resolveCustomerForLead({
      dealerId: "dealer-1",
      email: "both@example.com",
      phone: "4155551212",
      source: "test",
      leadId: new mongoose.Types.ObjectId(),
    });
    assert.deepEqual(joined.customerId, existing._id);
    assert.ok(updates.some(({ update }) => update.$set?.inbound_lead === true));

    const separate = await resolveCustomerForLead({
      dealerId: "dealer-1",
      email: "both@example.com",
      source: "test",
      leadId: new mongoose.Types.ObjectId(),
    });
    assert.notDeepEqual(separate.customerId, existing._id);
    assert.equal(savedCustomer.inbound_lead, true);
    assert.equal(savedCustomer.dealervault_upload, false);
  } finally {
    Customer.findOne = originalFindOne;
    Customer.updateOne = originalUpdateOne;
    Customer.prototype.save = originalSave;
  }
});

test("finalization assigns the Lead id only to introduced unset identities", async () => {
  const originalUpdateOne = Customer.updateOne;
  const customerId = new mongoose.Types.ObjectId();
  const leadId = new mongoose.Types.ObjectId();
  const updates = [];

  try {
    Customer.updateOne = async (query, update) => {
      updates.push({ query, update });
      return { matchedCount: 1, modifiedCount: 1 };
    };

    await finalizeCustomerIdentity({
      customerId,
      introducedEmails: ["person@example.com"],
      introducedPhones: ["4155551212"],
      leadId,
    });

    assert.equal(updates.length, 2);
    assert.ok(updates.some(({ query, update }) =>
      query.emails?.$elemMatch?.value === "person@example.com" &&
      query.emails.$elemMatch.first_seen_lead_id.$exists === false &&
      update.$set["emails.$.first_seen_lead_id"].equals(leadId)
    ));
    assert.ok(updates.some(({ query, update }) =>
      query.phones?.$elemMatch?.value === "4155551212" &&
      query.phones.$elemMatch.first_seen_lead_id.$exists === false &&
      update.$set["phones.$.first_seen_lead_id"].equals(leadId)
    ));
  } finally {
    Customer.updateOne = originalUpdateOne;
  }
});
