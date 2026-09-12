import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(await readFile(new URL('./Sales - 11 Inventory Resolver.json', import.meta.url), 'utf8'));
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const run = (name, { json = {}, nodes = {}, input = [], items = {} } = {}) =>
  new Function('$json', '$node', '$input', '$items', node(name).parameters.jsCode)(
    json,
    nodes,
    { all: () => input.map(value => ({ json: value })) },
    source => (items[source] ?? []).map(value => ({ json: value }))
  )[0].json;

const dealerId = '6a8f54debb10964e1ea194ac';
const makeEnvelope = ({ vehicle = {}, lead = {}, category = 'General Inquiry' } = {}) => ({
  schema_version: '8.0',
  channel: 'sms',
  event: { content: 'Vehicle question' },
  identity: { dealer_id: dealerId },
  context: { lead },
  intelligence: { vehicle, inquiry: { category } },
  inventory: null,
  decision: {},
  response: {}
});
const build = (vehicle = {}, options = {}) => run('Build Safe Inventory Queries', {
  json: makeEnvelope({ ...options, vehicle })
});
const resolve = (vehicle = {}, { lead = {}, category = 'General Inquiry', exactRows = [], alternativeRows = [] } = {}) => {
  const built = build(vehicle, { lead, category });
  return run('Resolve Inventory Result', {
    nodes: { 'Build Safe Inventory Queries': { json: built } },
    input: alternativeRows,
    items: { 'Find Exact VIN': exactRows }
  });
};
const validate = result => run('Validate Inventory Truth', { json: result });

const bmwRows = [
  { _id: 'bmw-2019-540', dealerId, vin: 'VIN540', year: 2019, make: 'BMW', model: '5 Series', trim: '540i xDrive', exteriorcolor: 'Black' },
  { _id: 'bmw-2023-530', dealerId, vin: 'VIN530', year: 2023, make: 'BMW', model: '5 Series', trim: '530i', exteriorcolor: 'White' },
  { _id: 'bmw-2019-530e', dealerId, vin: 'VIN530E', year: 2019, make: 'BMW', model: '5 Series', trim: '530e xDrive iPerformance', exteriorcolor: 'Blue' }
];
const makeModel = { vin: null, year: null, make: 'BMW', model: '5 Series' };

// Intelligence fields win when meaningful; keyed null/blank values fall back to lead context.
const leadVehicle = { vin: 'LEADVIN', year: '2018', make: 'Old Make', model: 'Old Model' };
assert.deepEqual(
  build(makeModel, { lead: leadVehicle }).envelope.inventory.request,
  { vin: 'LEADVIN', year: '2018', make: 'BMW', model: '5 Series' }
);
assert.deepEqual(
  build({ vin: null, year: '', make: '  ', model: '5 Series' }, { lead: leadVehicle }).envelope.inventory.request,
  { vin: 'LEADVIN', year: '2018', make: 'Old Make', model: '5 Series' }
);
assert.deepEqual(
  build({ make: 'BMW' }, { lead: leadVehicle }).envelope.inventory.request,
  { vin: 'LEADVIN', year: '2018', make: 'BMW', model: 'Old Model' }
);
assert.deepEqual(
  build({ vin: 'NEWVIN', year: 2024, make: 'BMW', model: '5 Series' }, { lead: leadVehicle }).envelope.inventory.request,
  { vin: 'NEWVIN', year: '2024', make: 'BMW', model: '5 Series' }
);
assert.deepEqual(build({}, { lead: {} }).envelope.inventory.request, { vin: null, make: null, model: null, year: null });
const noInventoryKey = resolve({});
assert.equal(noInventoryKey.inventory.status, 'UNKNOWN');
assert.ok(noInventoryKey.inventory.warnings.includes('NO_INVENTORY_KEY'));

// Query construction is dealer-scoped and includes every customer-supplied exact criterion.
const builtMakeModel = build(makeModel);
const makeModelExactQuery = JSON.parse(builtMakeModel.vin_query);
const makeModelAlternativeQuery = JSON.parse(builtMakeModel.model_query);
assert.equal(builtMakeModel.required, true);
assert.equal(makeModelExactQuery.dealerId, dealerId);
assert.ok(makeModelExactQuery.make.$regex);
assert.ok(makeModelExactQuery.model.$regex);
assert.equal(makeModelAlternativeQuery._id, '__NO_ALTERNATIVE_CRITERIA__');
assert.equal(new RegExp(makeModelExactQuery.model.$regex, makeModelExactQuery.model.$options).test('  5   SERIES '), true);

const builtYear = build({ vin: null, year: '2023', make: 'BMW', model: '5 Series' });
const yearExactQuery = JSON.parse(builtYear.vin_query);
const yearAlternativeQuery = JSON.parse(builtYear.model_query);
assert.deepEqual(yearExactQuery.year.$in, [2023, '2023']);
assert.ok(yearExactQuery.make.$regex);
assert.ok(yearExactQuery.model.$regex);
assert.equal(yearAlternativeQuery.dealerId, dealerId);
assert.equal(Object.hasOwn(yearAlternativeQuery, 'year'), false);

// Make/model-only requests can produce multiple exact matches; trim and color are output data, not hidden criteria.
const multipleExact = resolve(makeModel, { exactRows: [bmwRows[0], bmwRows[2], bmwRows[1]] });
assert.equal(multipleExact.inventory.status, 'UNKNOWN');
assert.equal(multipleExact.inventory.exact_match_count, 3);
assert.equal(multipleExact.inventory.exact_matches.length, 3);
assert.equal(multipleExact.inventory.exact_vehicle.year, 2023);
assert.equal(multipleExact.inventory.alternatives.length, 0);
assert.equal(multipleExact.inventory.authoritative_availability, false);
assert.ok(multipleExact.inventory.warnings.includes('MULTIPLE_EXACT_INVENTORY_MATCHES'));
assert.ok(multipleExact.inventory.warnings.includes('EXACT_MATCH_AVAILABILITY_UNRESOLVED'));
assert.deepEqual(multipleExact.inventory.exact_matches.map(row => row.trim), ['530i', '530e xDrive iPerformance', '540i xDrive']);

// Year is exact when supplied; other years remain alternatives.
const rowsWithAvailable2023 = bmwRows.map(row => row.year === 2023 ? { ...row, saleStatus: 'available' } : row);
const yearExact = resolve(
  { vin: null, year: '2023', make: ' bmw ', model: '5   series' },
  { exactRows: [rowsWithAvailable2023[1]], alternativeRows: [rowsWithAvailable2023[0], rowsWithAvailable2023[2]] }
);
assert.equal(yearExact.inventory.status, 'EXACT_AVAILABLE');
assert.equal(yearExact.inventory.exact_matches.length, 1);
assert.equal(yearExact.inventory.exact_vehicle.year, 2023);
assert.equal(yearExact.inventory.alternatives.length, 2);

const yearMismatch = resolve(
  { vin: null, year: '2024', make: 'BMW', model: '5 Series' },
  { alternativeRows: bmwRows }
);
assert.equal(yearMismatch.inventory.exact_vehicle, null);
assert.equal(yearMismatch.inventory.exact_matches.length, 0);
assert.equal(yearMismatch.inventory.status, 'ALTERNATIVES');
assert.equal(yearMismatch.inventory.alternatives.length, 3);

// The exact query is deliberately uncapped, so an exact year cannot be hidden behind five newer same-model rows.
assert.equal(Object.hasOwn(node('Find Exact VIN').parameters.options, 'limit'), false);
assert.equal(Object.hasOwn(node('Find Make Model').parameters.options, 'limit'), false);
const sevenYears = Array.from({ length: 7 }, (_, index) => ({
  _id: `year-${2025 - index}`, dealerId, vin: `VIN${2025 - index}`, year: 2025 - index, make: 'BMW', model: '5 Series'
}));
const olderExact = resolve(
  { year: '2019', make: 'BMW', model: '5 Series' },
  { exactRows: [sevenYears[6]], alternativeRows: sevenYears.slice(0, 6) }
);
assert.equal(olderExact.inventory.exact_vehicle.year, 2019);
assert.equal(olderExact.inventory.alternative_count, 6);
assert.equal(olderExact.inventory.alternatives.length, 5);

// Full result sets are classified and counted before deterministic output caps are applied.
const twentyExactRows = Array.from({ length: 20 }, (_, index) => ({
  _id: `exact-${String(index).padStart(2, '0')}`,
  dealerId,
  vin: `EXACTVIN${index}`,
  year: 2025 - index,
  make: 'BMW',
  model: '5 Series',
  status: index === 7 ? 'available' : undefined
}));
const twentyExact = resolve(makeModel, { exactRows: twentyExactRows });
assert.equal(twentyExact.inventory.exact_match_count, 20);
assert.equal(twentyExact.inventory.exact_matches.length, 5);
assert.equal(twentyExact.inventory.status, 'EXACT_AVAILABLE');
assert.equal(twentyExact.inventory.authoritative_availability, true);
assert.equal(twentyExact.inventory.exact_vehicle.vin, 'EXACTVIN7');
assert.equal(twentyExact.inventory.exact_matches.some(row => row.vin === 'EXACTVIN7'), false);

const eightAlternativeRows = Array.from({ length: 8 }, (_, index) => ({
  _id: `alternative-${index}`,
  dealerId,
  vin: `ALTVIN${index}`,
  year: 2022 - index,
  make: 'BMW',
  model: '5 Series'
}));
const eightAlternatives = resolve(
  { year: '2030', make: 'BMW', model: '5 Series' },
  { alternativeRows: eightAlternativeRows }
);
assert.equal(eightAlternatives.inventory.alternative_count, 8);
assert.equal(eightAlternatives.inventory.alternatives.length, 5);
assert.equal(eightAlternatives.inventory.status, 'ALTERNATIVES');
assert.equal(eightAlternatives.inventory.authoritative_availability, false);

// VIN remains the strongest exact identifier.
const vinVehicle = { ...bmwRows[1], status: 'available' };
const vinExact = resolve({ vin: ' vin530 ', year: null, make: null, model: null }, { exactRows: [vinVehicle] });
assert.equal(vinExact.inventory.status, 'EXACT_AVAILABLE');
assert.equal(vinExact.inventory.exact_vehicle.vin, 'VIN530');
assert.equal(vinExact.inventory.authoritative_availability, true);

// Make-only and model-only requests remain supported without inventing missing criteria.
const makeOnlyBuilt = build({ vin: null, year: null, make: 'BMW', model: null });
assert.equal(makeOnlyBuilt.required, true);
assert.equal(Object.hasOwn(JSON.parse(makeOnlyBuilt.vin_query), 'model'), false);
assert.equal(resolve({ make: 'BMW' }, { exactRows: bmwRows }).inventory.exact_matches.length, 3);
const modelOnlyBuilt = build({ vin: null, year: null, make: null, model: '5 Series' });
assert.equal(modelOnlyBuilt.required, true);
assert.equal(Object.hasOwn(JSON.parse(modelOnlyBuilt.vin_query), 'make'), false);
assert.equal(resolve({ model: '5 Series' }, { exactRows: bmwRows }).inventory.exact_matches.length, 3);

const noMatch = resolve(makeModel);
assert.equal(noMatch.inventory.status, 'UNKNOWN');
assert.equal(noMatch.inventory.exact_vehicle, null);
assert.ok(noMatch.inventory.warnings.includes('NO_INVENTORY_MATCH'));

// Inventory gating follows category semantics and known vehicle context.
for (const category of ['Availability Inquiry', 'Price Inquiry', 'Test Drive Request']) {
  assert.equal(build({}, { category }).required, true, `${category} must query inventory`);
}
for (const category of ['Closing', 'Negotiation', 'Delivery / Pickup']) {
  assert.equal(build({}, { category, lead: { make: 'BMW', model: '5 Series' } }).required, true, `${category} with a known lead vehicle must query inventory`);
  assert.equal(build({}, { category, lead: {} }).required, false, `${category} without a known vehicle must skip inventory`);
}
assert.equal(build({}, { category: 'General Inquiry', lead: {} }).required, false);

// Availability is authoritative only for repository-evidenced values or explicit booleans.
const missingAvailability = resolve(makeModel, { exactRows: [bmwRows[0]] });
assert.equal(missingAvailability.inventory.status, 'UNKNOWN');
assert.equal(missingAvailability.inventory.exact_vehicle.availability, null);
assert.ok(missingAvailability.inventory.warnings.includes('EXACT_MATCH_AVAILABILITY_UNRESOLVED'));
const soldExact = resolve(makeModel, { exactRows: bmwRows.map(row => ({ ...row, saleStatus: 'Sold' })) });
assert.equal(soldExact.inventory.status, 'EXACT_UNAVAILABLE');
assert.equal(soldExact.inventory.authoritative_availability, true);
assert.ok(soldExact.inventory.exact_matches.every(row => row.availability === false));
const reservedExact = resolve(makeModel, { exactRows: [{ ...bmwRows[0], saleStatus: 'reserved' }] });
assert.equal(reservedExact.inventory.status, 'UNKNOWN');
assert.equal(reservedExact.inventory.exact_vehicle.availability, null);
const explicitBoolean = resolve(makeModel, { exactRows: [{ ...bmwRows[0], is_available: false }] });
assert.equal(explicitBoolean.inventory.status, 'EXACT_UNAVAILABLE');
const explicitlyUnavailable = resolve(makeModel, { exactRows: [{ ...bmwRows[0], inventory_status: 'unavailable' }] });
assert.equal(explicitlyUnavailable.inventory.status, 'EXACT_UNAVAILABLE');

const soldAlternatives = validate(resolve(
  { vin: null, year: '2024', make: 'BMW', model: '5 Series' },
  { alternativeRows: bmwRows.map(row => ({ ...row, sold: true })) }
));
assert.equal(soldAlternatives.inventory.status, 'UNKNOWN');
assert.equal(soldAlternatives.inventory.alternatives.length, 0);
assert.equal(soldAlternatives.inventory.unavailable_matches.length, 3);
assert.ok(soldAlternatives.inventory.warnings.includes('ALL_ALTERNATIVES_EXPLICITLY_UNAVAILABLE'));

// Resolver-side tenant enforcement rejects cross-dealer rows even if a database node misbehaves.
const crossDealer = resolve(makeModel, { exactRows: [{ ...bmwRows[0], dealerId: 'different-dealer' }] });
assert.equal(crossDealer.inventory.exact_matches.length, 0);
assert.equal(crossDealer.inventory.alternatives.length, 0);
for (const name of ['Find Exact VIN', 'Find Make Model']) {
  assert.equal(node(name).parameters.collection, 'vehicles');
  assert.doesNotThrow(() => JSON.parse(node(name).parameters.options.sort));
}

console.log('Inventory Resolver regression checks passed.');
