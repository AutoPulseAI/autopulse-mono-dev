import assert from 'node:assert/strict';
import { CUSTOMER_MAPPING_INDEX } from '../app/models/Customer.js';

const path = 'extra.dealervault.customer_numbers';
export const query = value => ({ select() { return this; }, lean: async () => structuredClone(value) });
export const indexes = spec => ({ listIndexes: () => ({ toArray: async () => [{ ...spec.options, key: spec.key }] }) });

function values(object, parts) {
  if (!parts.length) return Array.isArray(object) ? object : [object];
  if (Array.isArray(object)) return object.flatMap(item => values(item, parts));
  return values(object?.[parts[0]], parts.slice(1));
}
export function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(clause => matches(document, clause));
    const actual = values(document, key.split('.'));
    if (value && typeof value === 'object') {
      if ('$in' in value) return actual.some(item => value.$in.includes(item));
      if ('$nin' in value) return actual.every(item => !value.$nin.includes(item));
      if ('$exists' in value) return actual.some(item => item !== undefined) === value.$exists;
      if ('$lte' in value) return actual.some(item => item <= value.$lte);
    }
    return actual.some(item => value === null ? item == null : item === value);
  });
}
export const duplicate = spec => Object.assign(new Error('private Mongo duplicate content'), { code: 11000, keyPattern: spec.key });

export function customers(initial = []) {
  const rows = structuredClone(initial);
  const calls = [];
  return {
    rows, calls, collection: indexes(CUSTOMER_MAPPING_INDEX),
    find(filter) { calls.push(['find', filter]); return query(rows.filter(row => matches(row, filter))); },
    findOne(filter) { calls.push(['findOne', filter]); return query(rows.find(row => matches(row, filter))); },
    async updateOne(filter, update) {
      calls.push(['updateOne', filter, update]);
      const row = rows.find(row => matches(row, filter));
      if (!row) return { matchedCount: 0 };
      const number = update.$addToSet?.[path];
      if (number !== undefined) {
        if (rows.some(other => other._id !== row._id && other.dealer_id === row.dealer_id && matches(other, { [path]: number }))) throw duplicate(CUSTOMER_MAPPING_INDEX);
      }
      if (update.$set) Object.assign(row, structuredClone(update.$set));
      if (number !== undefined) {
        row.extra ||= {};
        row.extra.dealervault ||= {};
        row.extra.dealervault.customer_numbers ||= [];
        if (!row.extra.dealervault.customer_numbers.includes(number)) row.extra.dealervault.customer_numbers.push(number);
      }
      return { matchedCount: 1 };
    },
    async create(data) {
      calls.push(['create', data]);
      const number = data.extra.dealervault.customer_numbers[0];
      if (rows.some(row => matches(row, { dealer_id: data.dealer_id, [path]: number }))) throw duplicate(CUSTOMER_MAPPING_INDEX);
      const row = { _id: `customer-${rows.length}`, ...structuredClone(data) };
      rows.push(row);
      return row;
    },
  };
}

export function staging() {
  const rows = [];
  return {
    rows,
    findOneAndUpdate(filter, update) {
      let row = rows.find(item => matches(item, filter));
      if (!row) { row = { processed_count: 0, failed_count: 0, unchanged_count: 0, ...update.$setOnInsert }; rows.push(row); }
      return query(row);
    },
    async updateOne(filter, update) {
      const row = rows.find(item => matches(item, filter));
      if (row) Object.assign(row, update.$set);
    },
  };
}

export function deals(naturalKey = 'deal_number') {
  const dealIndex = { key: { dealer_id: 1, [naturalKey]: 1 }, options: { unique: true } };
  const rows = [];
  const update = (filter, document) => {
    let row = rows.find(item => matches(item, filter));
    if (row) { Object.assign(row, structuredClone(document)); return { matchedCount: 1, modifiedCount: 1 }; }
    if (rows.some(item => item.dealer_id === filter.dealer_id && item[naturalKey] === filter[naturalKey])) throw duplicate(dealIndex);
    row = structuredClone(document);
    rows.push(row);
    return { upsertedCount: 1 };
  };
  return {
    rows, collection: indexes(dealIndex),
    findOne: filter => query(rows.find(row => matches(row, filter))),
    updateOne: async (filter, operation) => update(filter, operation.$set),
    async bulkWrite(operations, options) {
      assert.equal(options.ordered, false);
      const result = { upsertedCount: 0, matchedCount: 0, modifiedCount: 0 };
      const writeErrors = [];
      operations.forEach(({ updateOne }, index) => {
        try {
          const counts = update(updateOne.filter, updateOne.update.$set);
          for (const key of Object.keys(result)) result[key] += counts[key] || 0;
        } catch (error) { writeErrors.push({ ...error, index }); }
      });
      if (writeErrors.length) throw Object.assign(new Error('private'), { code: 11000, writeErrors, result });
      return result;
    },
  };
}
export const vehicles = (rows = []) => ({ find: filter => query(rows.filter(row => matches(row, filter))) });
