import Customer from "../models/Customer.js";

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

  if (await appendEmailIfMissing(customer._id, email, source)) {
    introducedEmails.push(email);
  }
  if (await appendPhoneIfMissing(customer._id, phone, source, smsOptIn)) {
    introducedPhones.push(phone);
  }

  return {
    customerId: customer._id,
    introducedEmails,
    introducedPhones,
    resolutionSucceeded: true,
    created: false,
  };
}

export async function resolveCustomerForLead({
  dealerId,
  name,
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

  const [emailCustomer, phoneCustomer] = await Promise.all([
    normalizedEmail
      ? Customer.findOne({ dealer_id: String(dealerId), "emails.value": normalizedEmail })
      : null,
    normalizedPhone
      ? Customer.findOne({ dealer_id: String(dealerId), "phones.value": normalizedPhone })
      : null,
  ]);

  if (emailCustomer && phoneCustomer && !emailCustomer._id.equals(phoneCustomer._id)) {
    console.warn("Customer identity conflict; leaving Lead unlinked", {
      dealer_id: String(dealerId),
      lead_id: String(leadId),
      email_customer_id: String(emailCustomer._id),
      phone_customer_id: String(phoneCustomer._id),
    });
    return unresolvedResult();
  }

  const existingCustomer = emailCustomer || phoneCustomer;
  if (existingCustomer) {
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
  const recheckedCustomer = await Customer.findOne({
    dealer_id: String(dealerId),
    $or: [
      ...(normalizedEmail ? [{ "emails.value": normalizedEmail }] : []),
      ...(normalizedPhone ? [{ "phones.value": normalizedPhone }] : []),
    ],
  });
  if (recheckedCustomer) {
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
  return {
    customerId: savedCustomer._id,
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
