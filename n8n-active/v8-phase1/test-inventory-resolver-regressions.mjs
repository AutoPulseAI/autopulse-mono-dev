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
const envelope = vehicle => ({
  schema_version: '8.0', channel: 'sms', event: { content: 'Vehicle question' }, identity: { dealer_id: dealerId },
  context: { lead: { vin: 'OLDVIN', year: '2018', make: 'Old Make', model: 'Old Model' } },
  intelligence: { vehicle, inquiry: { category: 'General Inquiry' } }, inventory: null, decision: {}, response: {}
});
const build = vehicle => run('Build Safe Inventory Queries', { json: envelope(vehicle) });
const resolve = (vehicle, { vinRows = [], modelRows = [] } = {}) => {
  const built = build(vehicle);
  return run('Resolve Inventory Result', {
    nodes: { 'Build Safe Inventory Queries': { json: built } }, input: modelRows,
    items: { 'Find Exact VIN': vinRows }
  });
};
const validate = result => run('Validate Inventory Truth', { json: result });

const bmwRows = [
  { _id: 'bmw-2019-540', dealerId, vin: 'VIN540', year: 2019, make: 'BMW', model: '5 Series', trim: '540i xDrive' },
  { _id: 'bmw-2023-530', dealerId, vin: 'VIN530', year: 2023, make: 'BMW', model: '5 Series', trim: '530i' },
  { _id: 'bmw-2019-530e', dealerId, vin: 'VIN530E', year: 2019, make: 'BMW', model: '5 Series', trim: '530e xDrive iPerformance' }
];

const makeModel = { vin: null, year: null, make: 'BMW', model: '5 Series' };
const builtMakeModel = build(makeModel);
assert.equal(builtMakeModel.required, true);
assert.deepEqual(builtMakeModel.envelope.inventory.request, makeModel);
assert.equal(JSON.parse(builtMakeModel.model_query).dealerId, dealerId);
assert.equal(Object.hasOwn(JSON.parse(builtMakeModel.model_query), 'year'), false);
const modelPattern = JSON.parse(builtMakeModel.model_query).model;
assert.equal(new RegExp(modelPattern.$regex, modelPattern.$options).test('  5   SERIES '), true);

const multipleExact = resolve(makeModel, { modelRows: bmwRows });
assert.equal(multipleExact.inventory.status, 'UNKNOWN');
assert.equal(multipleExact.inventory.exact_matches.length, 3);
assert.equal(multipleExact.inventory.exact_vehicle.model, '5 Series');
assert.equal(multipleExact.inventory.alternatives.length, 0);
assert.equal(multipleExact.inventory.authoritative_availability, false);
assert.ok(multipleExact.inventory.warnings.includes('MULTIPLE_EXACT_INVENTORY_MATCHES'));
assert.ok(multipleExact.inventory.warnings.includes('EXACT_MATCH_AVAILABILITY_UNRESOLVED'));

const rowsWithAvailable2023 = bmwRows.map(row => row.year === 2023 ? { ...row, available: true } : row);
const yearExact = resolve({ vin: null, year: '2023', make: ' bmw ', model: '5   series' }, { modelRows: rowsWithAvailable2023 });
assert.equal(yearExact.inventory.status, 'EXACT_AVAILABLE');
assert.equal(yearExact.inventory.exact_matches.length, 1);
assert.equal(yearExact.inventory.exact_vehicle.year, 2023);
assert.equal(yearExact.inventory.alternatives.length, 2);

const yearMismatch = resolve({ vin: null, year: '2024', make: 'BMW', model: '5 Series' }, { modelRows: bmwRows });
assert.equal(yearMismatch.inventory.exact_vehicle, null);
assert.equal(yearMismatch.inventory.exact_matches.length, 0);
assert.equal(yearMismatch.inventory.status, 'ALTERNATIVES');
assert.equal(yearMismatch.inventory.alternatives.length, 3);

const vinVehicle = { ...bmwRows[1], status: 'available' };
const vinExact = resolve({ vin: ' vin530 ', year: null, make: null, model: null }, { vinRows: [vinVehicle] });
assert.equal(vinExact.inventory.status, 'EXACT_AVAILABLE');
assert.equal(vinExact.inventory.exact_vehicle.vin, 'VIN530');
assert.equal(vinExact.inventory.authoritative_availability, true);

const makeOnlyBuilt = build({ vin: null, year: null, make: 'BMW', model: null });
assert.equal(makeOnlyBuilt.required, true);
assert.equal(Object.hasOwn(JSON.parse(makeOnlyBuilt.model_query), 'model'), false);
assert.equal(resolve({ vin: null, year: null, make: 'BMW', model: null }, { modelRows: bmwRows }).inventory.exact_matches.length, 3);

const modelOnlyBuilt = build({ vin: null, year: null, make: null, model: '5 Series' });
assert.equal(modelOnlyBuilt.required, true);
assert.equal(Object.hasOwn(JSON.parse(modelOnlyBuilt.model_query), 'make'), false);
assert.equal(resolve({ vin: null, year: null, make: null, model: '5 Series' }, { modelRows: bmwRows }).inventory.exact_matches.length, 3);

const noMatch = resolve(makeModel, { modelRows: [] });
assert.equal(noMatch.inventory.status, 'UNKNOWN');
assert.equal(noMatch.inventory.exact_vehicle, null);
assert.ok(noMatch.inventory.warnings.includes('NO_INVENTORY_MATCH'));

const soldExact = resolve(makeModel, { modelRows: bmwRows.map(row => ({ ...row, salestatus: 'Sold' })) });
assert.equal(soldExact.inventory.status, 'EXACT_UNAVAILABLE');
assert.equal(soldExact.inventory.authoritative_availability, true);
assert.ok(soldExact.inventory.exact_matches.every(row => row.availability === false));

const soldAlternatives = validate(resolve(
  { vin: null, year: '2024', make: 'BMW', model: '5 Series' },
  { modelRows: bmwRows.map(row => ({ ...row, sold: true })) }
));
assert.equal(soldAlternatives.inventory.status, 'UNKNOWN');
assert.equal(soldAlternatives.inventory.alternatives.length, 0);
assert.equal(soldAlternatives.inventory.unavailable_matches.length, 3);
assert.ok(soldAlternatives.inventory.warnings.includes('ALL_ALTERNATIVES_EXPLICITLY_UNAVAILABLE'));

const crossDealer = resolve(makeModel, { modelRows: [{ ...bmwRows[0], dealerId: 'different-dealer' }] });
assert.equal(crossDealer.inventory.exact_matches.length, 0);
assert.equal(crossDealer.inventory.alternatives.length, 0);
for (const name of ['Find Exact VIN', 'Find Make Model']) {
  assert.equal(node(name).parameters.collection, 'vehicles');
  assert.doesNotThrow(() => JSON.parse(node(name).parameters.options.sort));
}
assert.equal(JSON.parse(builtMakeModel.vin_query).dealerId, dealerId);

console.log('Inventory Resolver regression checks passed.');
