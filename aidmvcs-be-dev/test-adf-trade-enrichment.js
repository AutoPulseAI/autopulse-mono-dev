import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import mongoose from 'mongoose';
import { detectTradeCandidates, sanitizeTradeCandidate, hasTradeIdentity } from './app/lib/adfTradeCandidates.js';
import { extractTrade, validateTradeExtraction } from './app/lib/adfTradeExtraction.js';
import { enqueueAdfTrades, logTradeEvent } from './app/lib/adfTradeEnrichment.js';
import { createAdfTradeProcessor } from './app/worker/adfTradeWorker.js';
import TradeIn, { TRADE_SOURCE_INDEX } from './app/models/TradeIn.js';
import { parseAdfLeadEmail } from './app/lib/adfLeadParser.js';
import { ensureTradeIndexes } from './scripts/ensure-trade-in-indexes.js';

const oid = () => new mongoose.Types.ObjectId().toString();
const dealer = oid(), customer = oid(), lead = oid();
const adf = inner => `<adf><prospect><vehicle interest="buy"><year>2024</year><make>Ford</make><model>Escape</model></vehicle><customer><contact><email>private@example.com</email></contact></customer>${inner}</prospect></adf>`;
const tradeXml = '<vehicle interest="trade-in"><year>2018</year><make>Honda</make><model>Civic</model><odometer units="mi">80,000</odometer></vehicle>';
const source = xml => ({ _id: oid(), dealer_id: dealer, message_id: 'source-message', raw_xml: xml });
function query(value) { return { select() { return this; }, limit() { return this; }, async lean() { return value; } }; }
function harness(xml = adf(tradeXml)) {
  const raw = source(xml), records = [], logs = [], state = { customerId: customer, customerExists: true, error: null, modelCalls: 0 };
  class Trades {
    constructor(doc) { return new TradeIn(doc); }
    static findOne(filter) { return query(records.find(record => Object.entries(filter).every(([k,v]) => record[k] === v)) || null); }
    static async updateOne(filter, update) {
      if (state.error) throw state.error;
      if (records.some(record => Object.entries(filter).every(([k,v]) => record[k] === v))) return { upsertedCount: 0 };
      records.push({ ...update.$setOnInsert });
      return { upsertedCount: 1 };
    }
  }
  const dependencies = {
    connect: async () => {}, checkIndex: async () => {}, Trades,
    Raw: { findOne: filter => query(filter._id === raw._id && filter.dealer_id === raw.dealer_id ? raw : null) },
    Emails: { find: () => query([{ lead_id: lead }]) },
    Leads: {
      find: () => query([{ _id: lead, dealer_id: dealer, customer_id: state.customerId }]),
      findOne: filter => query(filter.customer_id === state.customerId ? { _id: lead } : null),
    },
    Customers: { findOne: () => query(state.customerExists ? { _id: customer } : null) },
    extract: async input => { state.modelCalls++; return input; },
    log: (...args) => logs.push(args),
  };
  const candidates = detectTradeCandidates(xml);
  const jobFor = (candidate = candidates[0]) => ({
    data: { raw_adf_payload_id: raw._id, dealer_id: dealer, source_message_id: raw.message_id, source_candidate_key: candidate.key },
    async updateData(data) { this.data = data; },
  });
  return { raw, state, records, logs, dependencies, jobFor, candidates, process: createAdfTradeProcessor(dependencies) };
}

test('no trade does not enqueue or call OpenAI, and original lead extraction stays unchanged', async () => {
  const xml = adf('');
  assert.deepEqual(detectTradeCandidates(xml), []);
  const previous = process.env.ADF_TRADE_ENRICHMENT_ENABLED;
  process.env.ADF_TRADE_ENRICHMENT_ENABLED = 'true';
  try {
    await enqueueAdfTrades(source(xml), { queueProvider: () => { throw new Error('must not call'); }, log: () => {} });
  } finally {
    if (previous === undefined) delete process.env.ADF_TRADE_ENRICHMENT_ENABLED;
    else process.env.ADF_TRADE_ENRICHMENT_ENABLED = previous;
  }
  assert.equal(parseAdfLeadEmail(xml).vehicle.model, 'Escape');
  assert.equal(parseAdfLeadEmail(adf(tradeXml)).vehicle.model, 'Escape');
});

test('structured ADF trade with no VIN persists against reloaded Lead and Customer', async () => {
  const h = harness();
  await h.process(h.jobFor());
  assert.equal(h.records.length, 1);
  const record = h.records[0];
  assert.equal(record.vin, null);
  assert.equal(record.year, 2018);
  assert.equal(record.miles, 80000);
  assert.equal(record.customer_id, customer);
  assert.equal(record.lead_id, lead);
  assert.equal(record.raw_adf_payload_id, h.raw._id);
  assert.equal(record.trade_offer_amount, undefined);
});

test('provider structures, attributes, namespaces, flattened trade fields, and nested containers', () => {
  for (const inner of [
    '<TradeIn><details><Year>2018</Year><Make>Honda</Make><Model>Civic</Model></details></TradeIn>',
    '<TradeVehicles><Vehicle year="2018" make="Honda" model="Civic" /></TradeVehicles>',
    '<provider><TradeYear>2018</TradeYear><TradeMake>Honda</TradeMake><TradeModel>Civic</TradeModel></provider>',
    '<x:CurrentVehicle xmlns:x="urn:test"><x:year>2018</x:year><x:make>Honda</x:make><x:model>Civic</x:model></x:CurrentVehicle>',
    '<vehicle interest="vehicle to trade"><comments>2018 Honda Civic</comments></vehicle>',
    '<trade-in>2018 Honda Civic</trade-in>',
    '<trade type="vehicle">2018 Honda Civic</trade>',
  ]) {
    const candidates = detectTradeCandidates(adf(inner));
    assert.equal(candidates.length, 1, inner);
    assert.equal(sanitizeTradeCandidate(candidates[0]).model, 'Civic');
  }
});

test('container notes do not hide nested trade vehicles', () => {
  const candidates = detectTradeCandidates(adf(`<trades><notes>customer has a trade</notes>${tradeXml}</trades>`));
  assert.equal(candidates.filter(item => hasTradeIdentity(sanitizeTradeCandidate(item))).length, 1);
});

test('labelled VINs are preserved, and multiple vehicles in prose are not mixed', () => {
  const safe = sanitizeTradeCandidate(detectTradeCandidates(adf('<trade><comments>2018 Honda Civic; VIN: 1HGCM82633A004352</comments></trade>'))[0]);
  assert.equal(safe.vin, '1HGCM82633A004352');
  const ambiguous = sanitizeTradeCandidate(detectTradeCandidates(adf('<comments>Trade vehicles: 2018 Honda Civic; 2020 Toyota Camry with 5000 miles</comments>'))[0]);
  assert.equal(hasTradeIdentity(ambiguous), false);
});

test('trade comments produce only vehicle facts and safe notes', () => {
  const xml = adf('<comments>I want to trade in my 2018 Honda Civic with 80,000 miles. Good condition; minor scratches; my name is John Smith; SSN 123-45-6789; payoff $8500; email me at private@example.com</comments>');
  const safe = sanitizeTradeCandidate(detectTradeCandidates(xml)[0]);
  assert.equal(safe.year, 2018);
  assert.equal(safe.make, 'Honda');
  assert.equal(safe.model, 'Civic');
  assert.equal(safe.miles, 80000);
  assert.equal(safe.condition.toLowerCase(), 'good');
  assert.equal(safe.notes, 'minor scratches');
  assert.doesNotMatch(JSON.stringify(safe), /John|Smith|123-45|8500|private|payoff/);
});

test('restricted fields and contaminated values never reach the outgoing OpenAI payload', async () => {
  const xml = adf(`<trade><year>2018</year><make>Honda</make><model>Civic</model>
    <vin>1HGCM82633A004352</vin><price>29000</price><payoff>8500</payoff><gross>1000</gross>
    <ssn>123-45-6789</ssn><account>0123456789</account><trim>SSN 123-45-6789</trim>
    <notes>minor scratches; trade worth 15000; John Smith; contact private@example.com; credit card 4111111111111111</notes></trade>`);
  const safe = sanitizeTradeCandidate(detectTradeCandidates(xml)[0]);
  let body;
  await extractTrade(safe, { apiKey: 'test', fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(safe) } }] }) };
  } });
  const serialized = JSON.stringify(body.messages[1]);
  assert.doesNotMatch(serialized, /123-45|8500|29000|15000|0123456789|4111111111111111|John|Smith|private|<adf/);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
});

test('missing facts stay null, invented VIN/condition and invalid output are rejected', () => {
  const input = sanitizeTradeCandidate(detectTradeCandidates(adf(tradeXml))[0]);
  assert.equal(input.vin, null);
  assert.equal(input.condition, null);
  assert.equal(input.trim, null);
  assert.deepEqual(validateTradeExtraction(input, input), input);
  for (const output of [{}, { ...input, vin: '1HGCM82633A004352' }, { ...input, condition: 'good' }, { ...input, extra: 'bad' }]) {
    assert.throws(() => validateTradeExtraction(output, input));
  }
});

test('unlabelled SSNs and phone numbers in vehicle labels are dropped', () => {
  for (const value of ['123-45-6789', '555-123-4567', '123 45 6789', '5551234567']) {
    const safe = sanitizeTradeCandidate({ fields: { model: value, trim: value } });
    assert.equal(safe.model, null);
    assert.equal(safe.trim, null);
  }
});

test('transport failures remain safe retryable enrichment errors', async () => {
  await assert.rejects(extractTrade({}, { apiKey: 'test', fetchImpl: async () => { throw new Error('private error body'); } }), /OPENAI_NETWORK_ERROR/);
});

test('insufficient or ambiguous trade description never calls OpenAI or creates a record', async () => {
  for (const xml of [adf('<trade><make>Honda</make></trade>'), adf('<comments>Trade in available, payoff $5000</comments>')]) {
    const h = harness(xml);
    await h.process(h.jobFor());
    assert.equal(h.state.modelCalls, 0);
    assert.equal(h.records.length, 0);
  }
  assert.equal(hasTradeIdentity({ year: 2018, make: 'Honda', model: null }), false);
  assert.deepEqual(detectTradeCandidates(adf('<comments>No trade in</comments>')), []);
});

test('OpenAI timeout and invalid response fail only the enrichment job', async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }) })]) {
    const h = harness();
    const processor = createAdfTradeProcessor({ ...h.dependencies,
      extract: input => extractTrade(input, { apiKey: 'test', fetchImpl, timeoutMs: 10 }) });
    await assert.rejects(processor(h.jobFor()), /OPENAI_TIMEOUT|INVALID_EXTRACTION/);
    assert.equal(h.state.customerId, customer);
    assert.equal(h.records.length, 0);
  }
});

test('customer linking uses persisted state, retries, and reuses extraction', async () => {
  const h = harness(), job = h.jobFor();
  job.data.customer_id = customer; // ignored, even though a forged value is present
  h.state.customerId = null;
  await assert.rejects(h.process(job), /CUSTOMER_UNRESOLVED/);
  assert.equal(h.records.length, 0);
  h.state.customerId = customer;
  await h.process(job);
  assert.equal(h.state.modelCalls, 1);
  assert.equal(h.records[0].customer_id, customer);
  assert.ok(h.logs.some(([event]) => event === 'waiting_for_customer'));
});

test('missing customer record and persistence errors cannot create orphan trades or expose errors', async () => {
  const h = harness(), job = h.jobFor();
  h.state.customerExists = false;
  await assert.rejects(h.process(job), /CUSTOMER_UNRESOLVED/);
  h.state.customerExists = true;
  h.state.error = new Error('SSN 123-45-6789');
  await assert.rejects(h.process(job), /^Error: TRADE_PROCESSING_FAILED$/);
  assert.equal(h.records.length, 0);
  assert.doesNotMatch(JSON.stringify(h.logs), /SSN|123-45/);
});

test('replay, multiple candidates and future appraisals retain correct identity', async () => {
  const h = harness(adf(tradeXml + tradeXml.replace('Civic', 'Accord')));
  assert.equal(h.candidates.length, 2);
  assert.equal(h.candidates[0].key, detectTradeCandidates(h.raw.raw_xml)[0].key);
  await Promise.all(h.candidates.map(candidate => h.process(h.jobFor(candidate))));
  await Promise.all(h.candidates.map(candidate => h.process(h.jobFor(candidate))));
  assert.equal(h.records.length, 2);
  assert.equal(h.state.modelCalls, 2);
  assert.ok(!Object.hasOwn(TRADE_SOURCE_INDEX.key, 'vin'));
  const future = harness(h.raw.raw_xml);
  assert.notEqual(future.raw._id, h.raw._id);
  await future.process(future.jobFor());
  assert.equal(future.records.length, 1);
});

test('concurrent replays atomically insert a candidate once', async () => {
  const h = harness();
  await Promise.all([h.process(h.jobFor()), h.process(h.jobFor())]);
  assert.equal(h.records.length, 1);
  assert.ok(h.logs.some(([event]) => event === 'duplicate_skipped'));
});

test('missing uniqueness index prevents OpenAI and persistence', async () => {
  const h = harness();
  const processJob = createAdfTradeProcessor({ ...h.dependencies, checkIndex: async () => { throw new Error('INDEX_REQUIRED'); } });
  await assert.rejects(processJob(h.jobFor()), /INDEX_REQUIRED/);
  assert.equal(h.state.modelCalls, 0);
  assert.equal(h.records.length, 0);
});

test('ambiguous or concurrently removed Lead ownership never creates a trade', async () => {
  for (const Leads of [
    { find: () => query([{ _id: lead, customer_id: customer }, { _id: oid(), customer_id: customer }]) },
    { find: () => query([{ _id: lead, customer_id: customer }]), findOne: () => query(null) },
  ]) {
    const h = harness();
    await assert.rejects(createAdfTradeProcessor({ ...h.dependencies, Leads })(h.jobFor()), /CUSTOMER_UNRESOLVED/);
    assert.equal(h.records.length, 0);
  }
});

test('enqueue failures are bounded and job payload contains only source identifiers', async () => {
  const previous = process.env.ADF_TRADE_ENRICHMENT_ENABLED;
  process.env.ADF_TRADE_ENRICHMENT_ENABLED = 'true';
  try {
    const raw = source(adf(tradeXml));
    const jobs = [];
    await enqueueAdfTrades(raw, { log: () => {}, queueProvider: async () => ({ add: async (...args) => jobs.push(args) }) });
    assert.equal(jobs.length, 1);
    assert.doesNotMatch(JSON.stringify(jobs[0][1]), /raw_xml|Honda|private|customer_id/);
    assert.equal(jobs[0][2].attempts, 6);
    await enqueueAdfTrades(raw, { timeoutMs: 10, log: () => {}, queueProvider: async () => new Promise(() => {}) });
  } finally {
    if (previous === undefined) delete process.env.ADF_TRADE_ENRICHMENT_ENABLED;
    else process.env.ADF_TRADE_ENRICHMENT_ENABLED = previous;
  }
});

test('model permits null numeric fields for imported trade and still requires identity', async () => {
  const base = { dealer_id: dealer, customer_id: customer, raw_adf_payload_id: oid(), lead_id: lead };
  await new TradeIn({ ...base, vin: '1HGCM82633A004352', year: null, miles: null }).validate();
  await new TradeIn({ ...base, vin: null, year: 2018, make: 'Honda', model: 'Civic' }).validate();
  await assert.rejects(new TradeIn({ ...base, vin: null }).validate());
  await assert.rejects(new TradeIn({ dealer_id: dealer, customer_id: customer, vin: null }).validate());
});

test('index script checks without mutation, creates once, and preserves unrelated indexes', async () => {
  const indexes = [], created = [];
  const connection = { collection: () => ({
    listIndexes: () => ({ toArray: async () => indexes }),
    createIndex: async (key, options) => { created.push(key); indexes.push({ key, ...options }); },
  }) };
  assert.equal(await ensureTradeIndexes(connection), 1);
  assert.equal(created.length, 0);
  assert.equal(await ensureTradeIndexes(connection, true), 0);
  assert.equal(await ensureTradeIndexes(connection, true), 0);
  assert.equal(created.length, 1);
});

test('structured logging drops arbitrary source text, keys and provider errors', () => {
  const original = console.info, logs = [];
  console.info = message => logs.push(message);
  try { logTradeEvent('created', { lead_id: lead, raw_xml: 'secret', customer_id: 'SSN 123-45-6789' }); }
  finally { console.info = original; }
  assert.doesNotMatch(logs.join(''), /secret|SSN|123-45/);
});

test('existing ADF branch persists Lead/Customer for no trade, queue failure, timeout and invalid extraction', async () => {
  // Execute the real ingestion functions with external services stubbed. Never
  // import emailWorker directly: its module-level DB connection is intentional.
  const code = await readFile(new URL('./app/worker/emailWorker.js', import.meta.url), 'utf8');
  const sourceCode = code.replace(/^import .*;.*$/gm, '').replace('await dbConnect();', '').replace('export async function processEmail', 'async function processEmail');
  for (const scenario of ['none', 'queue', 'timeout', 'invalid']) {
    const events = [], xml = adf(scenario === 'none' ? '' : tradeXml);
    let enrichment;
    class FakeLead {
      constructor(data) { Object.assign(this, data, { _id: lead }); }
      async save() { events.push('lead'); return this; }
    }
    const h = harness(xml);
    const context = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      RawAdfPayload: { findOneAndUpdate: () => query(h.raw) },
      enqueueAdfTrades: async () => {
        if (scenario === 'queue') throw new Error('queue unavailable');
        if (scenario === 'none') return;
        const fetchImpl = scenario === 'timeout' ? async () => new Promise(() => {})
          : async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }) });
        const processJob = createAdfTradeProcessor({ ...h.dependencies,
          extract: input => extractTrade(input, { apiKey: 'test', fetchImpl, timeoutMs: 10 }) });
        // Mimic the independent worker: accept the job without awaiting it.
        enrichment = assert.rejects(processJob(h.jobFor()), /OPENAI_TIMEOUT|INVALID_EXTRACTION/);
      },
      extractRawAdfText: value => value,
      parseAdfLeadEmail,
      User: { findOne: async () => ({ setting: { autoReplyEnabled: false } }) },
      Email: { findOne: async () => null, updateOne: async () => events.push('email-linked') },
      Lead: FakeLead,
      linkCustomerToLead: async document => { document.customer_id = customer; events.push('customer'); },
      onLeadStatusChange: async () => {},
    });
    vm.runInContext(`${sourceCode}\nthis.run = processEmail;`, context);
    await context.run({ data: { conversationThread: [], currentEmail: { mail_content: xml, dealer_id: dealer, message_id: 'msg' } } });
    await enrichment;
    assert.deepEqual(events, ['lead', 'customer', 'email-linked'], scenario);
    assert.equal(h.records.length, 0);
  }
});
