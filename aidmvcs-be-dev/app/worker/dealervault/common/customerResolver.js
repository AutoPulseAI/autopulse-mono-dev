import Customer, { CUSTOMER_MAPPING_INDEX } from '../../../models/Customer.js';
import { normalizeEmail, normalizePhone } from '../../../lib/customerResolver.js';
import { requireUniqueIndex } from './indexProtection.js';
import { mapBounded } from './bounded.js';

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

function relationship(customer) {
  return customer.merged_into
    ? { id: null, warning: 'CUSTOMER_MERGED' }
    : { id: customer._id };
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
      else if (matches[0]?.merged_into) result = { id: null, warning: 'CUSTOMER_MERGED' };
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
              customer = await Model.create({
                dealer_id,
                name: source['Full Name']?.trim() || [source['First Name'], source['Middle Name'], source['Last Name']]
                  .filter(Boolean).join(' ').trim() || undefined,
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
  });
}
