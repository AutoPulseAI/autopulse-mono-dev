import Customer, { CUSTOMER_MAPPING_INDEX } from '../../../models/Customer.js';
import { normalizeEmail, normalizePhone } from '../../../lib/customerResolver.js';
import { requireUniqueIndex } from './indexProtection.js';
import { mapBounded } from './bounded.js';
import { dmsNameParts } from '../../../lib/personName.js';
import { loadPolicy, rank } from '../../../lib/reconcile/policy.js';
import { decideUndated } from '../../../lib/reconcile/decide.js';
import { nameRow, recordHistory } from '../../../lib/reconcile/ledger.js';

// Customer.name_parts_from -> the source it stands for in the reconciliation policy.
const NAME_SOURCE = Object.freeze({ staff: 'DEALER_USER', dms: 'DMS', adf: 'LEAD', guess: 'GUESS' });

const mappingPath = 'extra.dealervault.customer_numbers';
const projection = '_id dealer_id emails.value phones.value extra.dealervault.customer_numbers merged_into dealervault_upload inbound_lead';
const unique = values => [...new Set(values.filter(Boolean))];
const numbers = customer => {
  const value = customer.extra?.dealervault?.customer_numbers;
  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
};
const hasDealerVaultOrigin = customer => customer.dealervault_upload === true || numbers(customer).length > 0;

function matchesContacts(customer, group) {
  const emailMatch = customer.emails?.some(email => group.emails.includes(email.value)) || false;
  const phoneMatch = customer.phones?.some(phone => group.phones.includes(phone.value)) || false;
  // A new cross-source relationship requires both normalized contacts.
  // Customers already known to DealerVault retain same-source OR matching.
  return hasDealerVaultOrigin(customer)
    ? emailMatch || phoneMatch
    : group.emails.length > 0 && group.phones.length > 0 && emailMatch && phoneMatch;
}

function contactFilter(emails, phones) {
  return [
    ...(emails.length ? [{ 'emails.value': { $in: emails } }] : []),
    ...(phones.length ? [{ 'phones.value': { $in: phones } }] : []),
  ];
}

function mappingDuplicate(error) {
  if (error.code !== 11000) return false;
  if (error.keyPattern) return JSON.stringify(error.keyPattern) === JSON.stringify(CUSTOMER_MAPPING_INDEX.key);
  // Inspect only for classification; never emit Mongo's duplicate value/message.
  return (error.message || '').includes(`index: ${CUSTOMER_MAPPING_INDEX.options.name} dup key:`);
}

// A merged customer's DealerVault records go to the customer it was merged into (G-008, app/lib/customerFamily.js).
function relationship(customer) {
  return customer.merged_into ? { id: customer.merged_into } : { id: customer._id };
}

export async function resolveCustomers(entries, context, Model = Customer) {
  await requireUniqueIndex(Model, CUSTOMER_MAPPING_INDEX);
  const dealer_id = context.dealer_id;
  const groups = new Map();
  for (const entry of entries) {
    // Aggregate duplicate DMS identities in a batch before matching contacts.
    const key = entry.document.customer_number ? `number:${entry.document.customer_number}` : `row:${entry.rowIndex}`;
    const group = groups.get(key) || { number: entry.document.customer_number, entries: [], emails: [], phones: [] };
    group.entries.push(entry);
    group.emails.push(...['Email 1', 'Email 2', 'Email 3'].map(field => normalizeEmail(entry.document[field])));
    group.phones.push(...['Home Phone', 'Cell Phone', 'Work Phone'].map(field => normalizePhone(entry.document[field])));
    groups.set(key, group);
  }
  const work = [...groups.values()];
  for (const group of work) {
    group.emails = unique(group.emails);
    group.phones = unique(group.phones);
  }
  const customerNumbers = unique(work.map(group => group.number));
  const contacts = contactFilter(unique(work.flatMap(group => group.emails)), unique(work.flatMap(group => group.phones)));
  const [mapped, candidates] = await Promise.all([
    customerNumbers.length ? Model.find({ dealer_id, [mappingPath]: { $in: customerNumbers } }).select(projection).lean() : [],
    contacts.length ? Model.find({ dealer_id, $or: contacts }).select(projection).lean() : [],
  ]);

  const readMapping = number => Model.findOne({ dealer_id, [mappingPath]: number }).select(projection).lean();
  const markDealerVaultOrigin = async (customer, { number, markInbound = false } = {}) => {
    if (customer.merged_into) return relationship(customer);
    const update = {
      $set: {
        dealervault_upload: true,
        ...(markInbound ? { inbound_lead: true } : {}),
      },
      ...(number ? { $addToSet: { [mappingPath]: number } } : {}),
    };
    const updated = await Model.updateOne(
      { dealer_id, _id: customer._id, merged_into: null },
      update,
    );
    return updated.matchedCount
      ? { id: customer._id }
      : { id: null, warning: 'CUSTOMER_UNRESOLVED' };
  };
  await mapBounded(work, 5, async group => {
    let result;
    const mappedMatches = group.number ? mapped.filter(customer => numbers(customer).includes(group.number)) : [];
    if (mappedMatches.length > 1) result = { id: null, warning: 'CUSTOMER_AMBIGUOUS' };
    else if (mappedMatches.length === 1) result = await markDealerVaultOrigin(mappedMatches[0]);
    else {
      const contactCandidates = candidates.filter(customer =>
        customer.emails?.some(email => group.emails.includes(email.value))
        || customer.phones?.some(phone => group.phones.includes(phone.value)));
      const matches = contactCandidates.filter(customer => matchesContacts(customer, group));
      if (matches.length > 1 || (!matches.length && contactCandidates.length > 1)) {
        result = { id: null, warning: 'CUSTOMER_AMBIGUOUS' };
      }
      else if (matches[0]?.merged_into) result = relationship(matches[0]);
      else if (!group.number) result = matches.length
        ? await markDealerVaultOrigin(matches[0], { markInbound: !hasDealerVaultOrigin(matches[0]) })
        : { id: null, warning: 'CUSTOMER_UNRESOLVED' };
      else {
        // A mapping committed after prefetch always takes precedence.
        let customer = await readMapping(group.number);
        if (customer) result = await markDealerVaultOrigin(customer);
        else {
          try {
            if (matches.length) {
              result = await markDealerVaultOrigin(matches[0], {
                number: group.number,
                markInbound: !hasDealerVaultOrigin(matches[0]),
              });
            } else {
              const source = group.entries[0].document;
              const parts = dmsNameParts(source);
              customer = await Model.create({
                dealer_id,
                name: source['Full Name']?.trim() || [source['First Name'], source['Middle Name'], source['Last Name']]
                  .filter(Boolean).join(' ').trim() || undefined,
                ...(parts ? { ...parts, name_parts_from: 'dms' } : {}),
                dealervault_upload: true,
                inbound_lead: false,
                emails: group.emails.map((value, index) => ({ value, is_primary: index === 0, source: 'dealervault' })),
                phones: group.phones.map((value, index) => ({ value, is_primary: !group.emails.length && index === 0, source: 'dealervault' })),
                extra: { dealervault: { customer_numbers: [group.number] } },
              });
            }
          } catch (error) {
            if (!mappingDuplicate(error)) throw error;
            customer = await readMapping(group.number);
            if (!customer) throw error;
            result = await markDealerVaultOrigin(customer);
          }
        }
        result ||= relationship(customer);
      }
    }
    for (const entry of group.entries) {
      entry.document.customer_id = result.id;
      if (result.warning) entry.warnings.push(result.warning);
    }
    // The DMS's first / middle / last go on the customer (19 Nov 2026: names in parts, so a sold customer lines up
    // with the DMS and forms fill by part). Only over a name from a source the dealer's policy ranks the same or below
    // the DMS (default: never over a name staff typed); each decision goes in the field history (23 Nov 2026, SOW
    // Appendix B). Never stops the import.
    const parts = result.id ? dmsNameParts(group.entries[0].document) : null;
    if (parts) {
      try {
        const policy = await loadPolicy(dealer_id);
        const allowed = Object.entries(NAME_SOURCE).filter(([, src]) => rank(policy.name, src) >= rank(policy.name, 'DMS'))
          .map(([from]) => from);
        const before = await Model.findOne({ dealer_id, _id: result.id })
          .select('first_name middle_name last_name suffix name_parts_from').lean();
        const shown = (c) => [c?.first_name, c?.middle_name, c?.last_name, c?.suffix].filter(Boolean).join(' ');
        const decision = decideUndated(policy.name, before && shown(before)
          ? { value: shown(before), source: NAME_SOURCE[before.name_parts_from] || 'GUESS' } : null,
        { value: shown(parts), source: 'DMS' });
        const res = await Model.updateOne({ dealer_id, _id: result.id, name_parts_from: { $in: [null, ...allowed] } },
          { $set: { ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v || null])), name_parts_from: 'dms' } });
        if (decision) {
          await recordHistory([nameRow({ dealerId: dealer_id, customerId: result.id, value: shown(parts), prior: shown(before),
            record: group.number, file: context.fileName,
            ...(res.modifiedCount || decision.decision !== 'ACCEPT' ? decision
              : { decision: 'RETAIN', reason: 'the name changed meanwhile; kept as it is' }) })]);
        }
      } catch { /* the name parts are optional */ }
    }
  });
}
