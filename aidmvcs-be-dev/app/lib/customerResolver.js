import Customer from "../models/Customer.js";
import { survivorOf } from "./customerFamily.js";
import { cleanPart, joinName } from "./personName.js";

// The AI extraction pipeline (Ollama/n8n) emits these literal strings when a
// field couldn't be found in the source email/SMS text, instead of omitting
// the field. Left unfiltered, "NA" would normalize to a truthy fake email
// and silently merge every lead with a failed extraction into one Customer.
const EMAIL_SENTINEL_VALUES = new Set([
  "na",
  "n/a",
  "null",
  "undefined",
  "none",
  "unknown",
]);

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || EMAIL_SENTINEL_VALUES.has(normalized)) return null;
  return normalized;
}

// For sanitizing a raw LLM-extracted value *before* it's stored on a Lead
// (as opposed to normalizeEmail, which also lowercases/trims for the
// Customer-identity lookup key). Lets callers null out a sentinel without
// otherwise touching the value's original casing/formatting.
export function isEmailSentinel(value) {
  if (typeof value !== "string") return false;
  return EMAIL_SENTINEL_VALUES.has(value.trim().toLowerCase());
}

export function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const input = String(value).trim();
  if (!input) return null;

  let digits = input.replace(/\D/g, "");
  if (!digits) return null;

  // Collapse the optional US/Canada '1' country-code prefix so the same
  // number normalizes identically whether it arrives as '4155551212'
  // (e.g. LLM-extracted from message text) or '+14155551212' (Twilio's
  // E.164 'From'). Mirrors the default-to-US convention already used by
  // formatPhoneForTwilio() in the workers.
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  return digits;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function hasDealerVaultOrigin(customer) {
  const customerNumbers = customer?.extra?.dealervault?.customer_numbers;
  return customer?.dealervault_upload === true
    || (Array.isArray(customerNumbers) ? customerNumbers.length > 0 : typeof customerNumbers === "string");
}

// A customer with dealership history from DealerVault (a sale or a service visit) is joined by a new lead only after a
// manager has confirmed who they are - here, a merge that is still in place (app/api/customers/merge records the
// manager and the time). Betsy, 25 Nov 2026: "they should be tethered, not merged ... if the dealership wants to merge
// it, they can click a button and say yes, this is a match" - otherwise anyone with a customer's phone and email could
// send a lead and have the AI and the staff see that customer's purchases. Such a lead gets its own customer, which
// shares the phone / email and so is listed under Customers > Possible duplicates for a manager to link.
export function identityConfirmed(customer) {
  return (customer?.merge_history || []).some((h) => h && !h.reversed_at);
}

export function autoLinkAllowed(customer) {
  return !hasDealerVaultOrigin(customer) || identityConfirmed(customer);
}

function sameCustomer(first, second) {
  return first && second && String(first._id) === String(second._id);
}

// A merged customer (G-008, app/lib/customerFamily.js) hands its new leads to the customer it was merged into.
async function keptCustomer(customer, dealerId) {
  if (!customer?.merged_into) return customer;
  return Customer.findOne({ _id: await survivorOf(customer._id, dealerId), dealer_id: String(dealerId) });
}

// Every customer (after merges) holding this contact: the ones a lead may join first, oldest first.
async function contactCandidates(dealerId, field, value) {
  if (!value) return { usable: null, heldBack: [] };
  const found = await Customer.find({ dealer_id: String(dealerId), [field]: value }).sort({ createdAt: 1 }).limit(20);
  const seen = new Set();
  const kept = [];
  for (const c of found || []) {
    const k = await keptCustomer(c, dealerId);
    if (k && !seen.has(String(k._id))) { seen.add(String(k._id)); kept.push(k); }
  }
  return { usable: kept.find(autoLinkAllowed) || null, heldBack: kept.filter((c) => !autoLinkAllowed(c)) };
}

async function findContactMatches(dealerId, email, phone) {
  const [byEmail, byPhone] = await Promise.all([
    contactCandidates(dealerId, "emails.value", email),
    contactCandidates(dealerId, "phones.value", phone),
  ]);
  return { emailCustomer: byEmail.usable, phoneCustomer: byPhone.usable,
    heldBack: [...byEmail.heldBack, ...byPhone.heldBack] };
}

function selectInboundCustomer(emailCustomer, phoneCustomer) {
  if (emailCustomer && phoneCustomer && !sameCustomer(emailCustomer, phoneCustomer)) {
    return { customer: null, conflict: true };
  }
  return { customer: emailCustomer || phoneCustomer || null, conflict: false };
}

function unresolvedResult() {
  return {
    customerId: null,
    introducedEmails: [],
    introducedPhones: [],
    resolutionSucceeded: false,
    created: false,
  };
}

async function pushIfMissing(customerId, arrayField, matchValue, entry) {
  const result = await Customer.updateOne(
    {
      _id: customerId,
      [`${arrayField}.value`]: { $ne: matchValue },
      // G-061: a contact staff removed from this customer is never added back by a later lead or import.
      removed_contacts: { $not: { $elemMatch: { kind: arrayField === "emails" ? "email" : "phone", value: matchValue } } },
    },
    { $push: { [arrayField]: entry } }
  );

  // A zero-match conditional update is an expected no-op: the value may
  // already have been added concurrently, or the Customer may have been
  // removed.
  return result.matchedCount === 1 && result.modifiedCount === 1;
}

async function appendEmailIfMissing(customerId, normalizedEmail, source) {
  if (!normalizedEmail) return false;

  return pushIfMissing(customerId, "emails", normalizedEmail, {
    value: normalizedEmail,
    is_primary: false,
    source,
    added_at: new Date(),
  });
}

async function appendPhoneIfMissing(customerId, normalizedPhone, source, smsOptIn) {
  if (!normalizedPhone) return false;

  const phone = {
    value: normalizedPhone,
    is_primary: false,
    source,
    added_at: new Date(),
  };
  if (smsOptIn !== undefined && smsOptIn !== null) {
    phone.sms_opt_in = smsOptIn;
  }

  const introduced = await pushIfMissing(customerId, "phones", normalizedPhone, phone);

  if (!introduced && smsOptIn === true) {
    // The phone already existed on this Customer, so the $push above never
    // ran — but this contact just confirmed opt-in via this channel (e.g. an
    // inbound SMS), so still record it on the existing entry. Only ever sets
    // it to true, and only writes when it isn't already true, to avoid
    // clobbering an explicit false with a weaker signal.
    await Customer.updateOne(
      {
        _id: customerId,
        phones: { $elemMatch: { value: normalizedPhone, sms_opt_in: { $ne: true } } },
      },
      { $set: { "phones.$.sms_opt_in": true } }
    );
  }

  return introduced;
}

async function enrichCustomer(customer, { email, phone, source, smsOptIn }) {
  const introducedEmails = [];
  const introducedPhones = [];

  await Customer.updateOne(
    { _id: customer._id },
    { $set: { inbound_lead: true } }
  );

  if (await appendEmailIfMissing(customer._id, email, source)) {
    introducedEmails.push(email);
  }
  if (await appendPhoneIfMissing(customer._id, phone, source, smsOptIn)) {
    introducedPhones.push(phone);
  }

  return {
    customerId: customer._id,
    assignedTo: customer.assigned_to || null,
    introducedEmails,
    introducedPhones,
    resolutionSucceeded: true,
    created: false,
  };
}

// The lead provider's first / middle / last (ADF) as Customer fields, or null.
function adfParts(nameParts) {
  if (!nameParts) return null;
  const parts = { first_name: cleanPart(nameParts.first), middle_name: cleanPart(nameParts.middle),
    last_name: cleanPart(nameParts.last) };
  return parts.first_name || parts.last_name ? parts : null;
}

// An existing customer with no name parts (or only guessed ones) takes the provider's, when it is the same name.
async function fillAdfParts(customerId, name, nameParts) {
  const parts = adfParts(nameParts);
  if (!parts || !customerId) return;
  const full = joinName(parts) || cleanPart(name);
  const exact = new RegExp(`^\\s*${full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  try {
    await Customer.updateOne({ _id: customerId, name: exact, name_parts_from: { $in: [null, "guess"] } },
      { $set: { ...parts, name_parts_from: "adf" } });
  } catch { /* the name parts never stop a lead being linked */ }
}

export async function resolveCustomerForLead({
  dealerId,
  name,
  nameParts,
  email,
  phone,
  source,
  leadId,
  smsOptIn,
}) {
  if (!hasValue(dealerId)) {
    throw new Error("dealerId is required for customer resolution");
  }
  if (!leadId) {
    throw new Error("leadId is required for customer resolution");
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedEmail && !normalizedPhone) {
    return {
      customerId: null,
      introducedEmails: [],
      introducedPhones: [],
      resolutionSucceeded: true,
      created: false,
    };
  }

  const { emailCustomer, phoneCustomer, heldBack } = await findContactMatches(
    dealerId,
    normalizedEmail,
    normalizedPhone
  );
  const initialMatch = selectInboundCustomer(emailCustomer, phoneCustomer);

  if (initialMatch.conflict) {
    console.warn("Customer identity conflict; leaving Lead unlinked", {
      dealer_id: String(dealerId),
      lead_id: String(leadId),
      email_customer_id: String(emailCustomer._id),
      phone_customer_id: String(phoneCustomer._id),
    });
    return unresolvedResult();
  }

  const existingCustomer = initialMatch.customer;
  if (existingCustomer) {
    await fillAdfParts(existingCustomer._id, name, nameParts);
    return enrichCustomer(existingCustomer, {
      email: normalizedEmail,
      phone: normalizedPhone,
      source,
      smsOptIn,
    });
  }

  // TODO(customer-dedup-race): this recheck-then-create is not race-safe.
  // Two concurrent resolveCustomerForLead calls for the same new identifier
  // (e.g. an email job and an SMS job for the same brand-new customer firing
  // near-simultaneously) can both miss here and both proceed to `customer.save()`
  // below, creating two Customer docs for one person, because the indexes on
  // { dealer_id, "emails.value" } / { dealer_id, "phones.value" } (Customer.js)
  // are not unique. Fix: make those indexes `unique` (with a partialFilterExpression
  // so empty arrays don't collide), then replace this recheck with a
  // try { await customer.save() } catch (err) { if (err.code === 11000) { re-findOne
  // and enrichCustomer() the winner instead } } around the create below, so Mongo's
  // uniqueness constraint — not an app-level read — is what closes the race.
  const recheckedMatches = await findContactMatches(dealerId, normalizedEmail, normalizedPhone);
  const rechecked = selectInboundCustomer(recheckedMatches.emailCustomer, recheckedMatches.phoneCustomer);
  if (rechecked.conflict) return unresolvedResult();
  const recheckedCustomer = rechecked.customer;
  if (recheckedCustomer) {
    await fillAdfParts(recheckedCustomer._id, name, nameParts);
    return enrichCustomer(recheckedCustomer, {
      email: normalizedEmail,
      phone: normalizedPhone,
      source,
      smsOptIn,
    });
  }

  const customer = new Customer({
    dealer_id: String(dealerId),
    name,
    ...(adfParts(nameParts) ? { ...adfParts(nameParts), name_parts_from: "adf" } : {}),
    dealervault_upload: false,
    inbound_lead: true,
    emails: normalizedEmail
      ? [{
          value: normalizedEmail,
          is_primary: true,
          source,
          added_at: new Date(),
        }]
      : [],
    phones: normalizedPhone
      ? [{
          value: normalizedPhone,
          is_primary: !normalizedEmail,
          ...(smsOptIn !== undefined && smsOptIn !== null ? { sms_opt_in: smsOptIn } : {}),
          source,
          added_at: new Date(),
        }]
      : [],
  });

  const savedCustomer = await customer.save();
  if (heldBack.length) {
    console.info("Lead not joined to a DealerVault customer until a manager confirms the match", {
      dealer_id: String(dealerId), lead_id: String(leadId), new_customer_id: String(savedCustomer._id),
      possible_match_ids: [...new Set(heldBack.map((c) => String(c._id)))],
    });
  }
  return {
    ...(heldBack.length ? { possibleMatchIds: [...new Set(heldBack.map((c) => String(c._id)))] } : {}),
    customerId: savedCustomer._id,
    // Always null here - a brand-new Customer has no assignment yet.
    assignedTo: null,
    introducedEmails: normalizedEmail ? [normalizedEmail] : [],
    introducedPhones: normalizedPhone ? [normalizedPhone] : [],
    resolutionSucceeded: true,
    created: true,
  };
}

/**
 * Resolves/creates the Customer for an already-saved Lead and links them.
 *
 * Takes a Lead that has already been persisted (has a real `_id` and won't
 * disappear on error) so that Customer mutations only ever happen for leads
 * that actually made it to the database — if this is called before the lead
 * is saved and the save then fails, an identifier can get permanently marked
 * as "already introduced" on the Customer with no lead left to point at it.
 *
 * Returns the underlying customer-resolution result (see
 * resolveCustomerForLead) - notably `customerId` and `created` (true only
 * when a brand-new Customer was made, false when an existing one was
 * matched/enriched) - or `undefined` if resolution itself threw. Most
 * callers ignore the return value; it exists for callers (e.g. the
 * orphaned-leads backfill script) that need to know whether a new Customer
 * was created.
 */
export async function linkCustomerToLead(savedLead, { source, smsOptIn } = {}) {
  let customerResolution;
  try {
    customerResolution = await resolveCustomerForLead({
      dealerId: savedLead.dealer_id,
      name: savedLead.name,
      nameParts: savedLead.first_name || savedLead.last_name
        ? { first: savedLead.first_name, middle: savedLead.middle_name, last: savedLead.last_name } : null,
      email: savedLead.email,
      phone: savedLead.phone,
      source: source || savedLead.source,
      leadId: savedLead._id,
      smsOptIn,
    });
  } catch (customerError) {
    console.error(`Customer resolution failed for lead ${savedLead._id}:`, customerError);
    return;
  }

  if (!customerResolution.customerId) return customerResolution;

  try {
    savedLead.customer_id = customerResolution.customerId;
    // Inherit the customer's current owner so a newly linked lead doesn't
    // start unassigned (or differently assigned) under an already-assigned
    // customer - see app/api/customers/[id]/route.js PUT, which cascades the
    // other direction (assigning the customer reassigns its existing leads).
    savedLead.assigned_to = customerResolution.assignedTo || null;
    await savedLead.save();
  } catch (linkError) {
    console.error(`Failed to set customer_id on lead ${savedLead._id}:`, linkError);
  }

  if (customerResolution.resolutionSucceeded) {
    try {
      await finalizeCustomerIdentity({
        ...customerResolution,
        leadId: savedLead._id,
      });
    } catch (finalizationError) {
      console.error(`Customer identity finalization failed for lead ${savedLead._id}:`, finalizationError);
    }
  }

  return customerResolution;
}

export async function finalizeCustomerIdentity({
  customerId,
  introducedEmails = [],
  introducedPhones = [],
  leadId,
}) {
  if (!customerId || !leadId) return;

  await Promise.all([
    ...introducedEmails.map((normalizedEmail) =>
      Customer.updateOne(
        {
          _id: customerId,
          emails: {
            $elemMatch: {
              value: normalizedEmail,
              first_seen_lead_id: { $exists: false },
            },
          },
        },
        { $set: { "emails.$.first_seen_lead_id": leadId } }
      )
    ),
    ...introducedPhones.map((normalizedPhone) =>
      Customer.updateOne(
        {
          _id: customerId,
          phones: {
            $elemMatch: {
              value: normalizedPhone,
              first_seen_lead_id: { $exists: false },
            },
          },
        },
        { $set: { "phones.$.first_seen_lead_id": leadId } }
      )
    ),
  ]);
}
