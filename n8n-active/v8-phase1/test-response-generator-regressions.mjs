import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(await readFile(new URL('./SMS - 20 Response Generator.json', import.meta.url), 'utf8'));
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const merge = (base, override) => {
  if (Array.isArray(override)) return override;
  if (!override || typeof override !== 'object') return override;
  const result = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(result[key], value) : value;
  }
  return result;
};

const baseEnvelope = {
  schema_version: '8.0',
  event: { content: 'Please help', sender: '+15550001111' },
  context: { dealer: {}, sms_history: [], email_history: [], lead_notes: [] },
  intelligence: { appointment: { signal: 'NONE' } },
  inventory: {},
  decision: {
    route: 'GENERAL',
    cta_type: 'answer_question',
    inventory_claim_mode: 'not_applicable',
    response_objective: 'Answer directly.',
    language: 'English',
    language_code: 'en',
    tone: 'neutral',
    max_characters: 300,
    send_user_response: true,
    block_delivery: false,
    allowed_links: [],
    allowed_facts: {
      customer: {},
      vehicle: {},
      inventory: {},
      appointment: { signal: 'NONE', date: null, time: null },
      dealer: { store_hours: [], store_hours_text: null, store_hours_status: 'UNAVAILABLE', timezone: null },
      links: { vdp: null, trade: null, finance: null, booking: null, store_website: null }
    }
  },
  response: {}
};
const envelope = override => merge(baseEnvelope, override);
const safeCode = node('Safe Generator Output').parameters.jsCode;
const runSafe = (modelResult, override = {}) => new Function('$json', '$node', safeCode)(
  modelResult,
  { 'Sub-workflow Input': { json: envelope(override) } }
)[0].json;
const runSkip = override => new Function('$json', node('Skip Customer Wording').parameters.jsCode)(envelope(override))[0].json;
const switchExpression = node('Wording Required').parameters.output.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
const switchOutput = override => new Function('$json', `return (${switchExpression});`)(envelope(override));
const output = value => ({ output: JSON.stringify({ sms_response: value, email_subject: null, email_body: null, booking_date: null, booking_time: null }) });
const prompt = node('Generate Approved Wording').parameters.text;

// Labeled links are the sole semantic and post-parse URL authority.
const urls = {
  vdp: 'https://dealer.example/vehicle/123',
  trade: 'https://dealer.example/form/trade',
  finance: 'https://dealer.example/form/finance',
  booking: 'https://dealer.example/form/booking',
  store_website: 'https://dealer.example/home'
};
for (const key of ['vdp', 'trade', 'finance', 'booking']) {
  const placeholder = `[${key.toUpperCase()}_LINK]`;
  const result = runSafe(output(`Use ${placeholder}`), { decision: { allowed_facts: { links: { [key]: urls[key] } }, allowed_links: [urls[key]] } });
  assert.equal(result.response.candidate.sms_response, `Use ${urls[key]}`);
  assert.equal(result.response.generation.allowed_links_by_type[key], urls[key]);
}
const sameDomain = runSafe(output('Compare [TRADE_LINK] and [FINANCE_LINK]'), {
  decision: { allowed_facts: { links: { trade: urls.trade, finance: urls.finance } }, allowed_links: [urls.trade, urls.finance] }
});
assert.match(sameDomain.response.candidate.sms_response, /form\/trade/);
assert.match(sameDomain.response.candidate.sms_response, /form\/finance/);
const unlabeledFinance = runSafe(output('Finance here: [FINANCE_LINK]'), {
  decision: { allowed_facts: { links: { trade: urls.trade, finance: null } }, allowed_links: [urls.trade, urls.finance] }
});
assert.doesNotMatch(unlabeledFinance.response.candidate.sms_response, /form\/finance/);
assert.ok(unlabeledFinance.response.generation.warnings.includes('MISSING_LABELED_LINK:finance'));
assert.doesNotMatch(unlabeledFinance.response.candidate.sms_response, /form\/trade/);
const bookingCannotSubstituteForVdp = runSafe(output('Vehicle details: [VDP_LINK]'), {
  decision: { allowed_facts: { links: { vdp: null, booking: urls.booking } }, allowed_links: [urls.booking] }
});
assert.doesNotMatch(bookingCannotSubstituteForVdp.response.candidate.sms_response, /form\/booking/);
assert.ok(bookingCannotSubstituteForVdp.response.generation.warnings.includes('MISSING_LABELED_LINK:vdp'));
const literalUrl = runSafe(output(`Use ${urls.vdp}`), { decision: { allowed_facts: { links: { vdp: urls.vdp } }, allowed_links: [urls.vdp] } });
assert.doesNotMatch(literalUrl.response.candidate.sms_response, /https?:\/\//);
assert.ok(literalUrl.response.generation.warnings.some(warning => warning.startsWith('MODEL_LITERAL_URL_REMOVED:')));
assert.match(prompt, /\[TRADE_LINK\].*links\.trade/i);
assert.match(prompt, /\[FINANCE_LINK\].*links\.finance/i);
assert.match(prompt, /\[BOOKING_LINK\].*links\.booking/i);
assert.match(prompt, /\[VDP_LINK\].*links\.vdp/i);
assert.match(prompt, /never substitute one placeholder for another purpose/i);
assert.match(prompt, /Never copy a literal URL.*infer a link's purpose from its domain/i);

// Generation routing fails closed for blocked, disabled, DND, or incomplete decisions.
assert.equal(switchOutput({ decision: { send_user_response: true, block_delivery: false, route: 'GENERAL' } }), 1);
assert.equal(switchOutput({ decision: { send_user_response: true, block_delivery: true, route: 'GENERAL' } }), 0);
assert.equal(switchOutput({ decision: { send_user_response: false, block_delivery: false, route: 'GENERAL' } }), 0);
assert.equal(switchOutput({ decision: { send_user_response: null, block_delivery: null, route: null } }), 0);
const blocked = runSkip({ decision: { send_user_response: true, block_delivery: true } });
assert.equal(blocked.response.candidate.sms_response, null);
assert.equal(blocked.response.generation.attempted, false);
assert.equal(blocked.response.generation.skipped_reason, 'BLOCK_DELIVERY');
const disabled = runSkip({ decision: { send_user_response: false, block_delivery: false } });
assert.equal(disabled.response.generation.skipped_reason, 'SEND_USER_RESPONSE_FALSE_OR_MISSING');
const defensiveBlocked = runSafe(output('This must not be used.'), { decision: { send_user_response: true, block_delivery: true } });
assert.equal(defensiveBlocked.response.candidate.sms_response, null);
assert.equal(defensiveBlocked.response.generation.attempted, false);

// Code-point length enforcement accepts the boundary and replaces unsafe excess with a short route-safe fallback.
const exactly300 = runSafe(output('a'.repeat(300)));
assert.equal(Array.from(exactly300.response.candidate.sms_response).length, 300);
assert.equal(exactly300.response.generation.status, 'generated');
const over300 = runSafe(output('a'.repeat(301)));
assert.ok(Array.from(over300.response.candidate.sms_response).length <= 300);
assert.ok(over300.response.generation.warnings.includes('SMS_RESPONSE_OVER_LIMIT'));
assert.ok(over300.response.generation.warnings.includes('OVER_LIMIT_RESPONSE_REPLACED_WITH_SAFE_FALLBACK'));
const overWithUrl = runSafe(output(`${'x'.repeat(280)} [VDP_LINK]`), {
  decision: { allowed_facts: { links: { vdp: urls.vdp } }, allowed_links: [urls.vdp] }
});
assert.ok(Array.from(overWithUrl.response.candidate.sms_response).length <= 300);
assert.doesNotMatch(overWithUrl.response.candidate.sms_response, /https?:\/\//);
const emojiBoundary = runSafe(output('😀'.repeat(150)));
assert.equal(emojiBoundary.response.candidate.sms_response, '😀'.repeat(150));
assert.equal(emojiBoundary.response.candidate.sms_response.length, 300);
assert.doesNotMatch(emojiBoundary.response.candidate.sms_response, /[\uD800-\uDBFF]$/);
const emojiOver = runSafe(output('😀'.repeat(151)));
assert.ok(emojiOver.response.candidate.sms_response.length <= 300);
assert.doesNotMatch(emojiOver.response.candidate.sms_response, /[\uD800-\uDBFF]$/);
const customBoundary = runSafe(output('12345678901234567890'), { decision: { max_characters: 20 } });
assert.equal(Array.from(customBoundary.response.candidate.sms_response).length, 20);
const customOver = runSafe(output('123456789012345678901'), { decision: { max_characters: 20 } });
assert.equal(customOver.response.candidate.sms_response, null);
assert.equal(customOver.response.generation.status, 'failed');
assert.ok(customOver.response.generation.warnings.includes('SMS_OVER_LIMIT_NO_SAFE_FALLBACK'));

// LLM-failure appointment fallbacks reuse only approved date/time and ask only for missing fields.
const malformed = { output: 'not json' };
const visit = appointment => ({
  decision: { route: 'VISIT', allowed_facts: { appointment } },
  intelligence: { appointment: { signal: appointment.signal ?? 'INTEREST' } }
});
const knownSlot = runSafe(malformed, visit({ signal: 'INTEREST', date: '2026-09-20', time: '2:00 PM' }));
assert.match(knownSlot.response.candidate.sms_response, /2026-09-20.*2:00 PM/);
assert.doesNotMatch(knownSlot.response.candidate.sms_response, /What day and time/);
const confirmedSlot = runSafe(malformed, { decision: { route: 'BOOKING', allowed_facts: { appointment: { signal: 'BOOKED', date: '2026-09-20', time: '2:00 PM' } } }, intelligence: { appointment: { signal: 'BOOKED' } } });
assert.match(confirmedSlot.response.candidate.sms_response, /appointment is set/i);
const dateOnly = runSafe(malformed, visit({ signal: 'INTEREST', date: '2026-09-20', time: null }));
assert.match(dateOnly.response.candidate.sms_response, /What time/);
assert.doesNotMatch(dateOnly.response.candidate.sms_response, /What day/);
const timeOnly = runSafe(malformed, visit({ signal: 'INTEREST', date: null, time: '2:00 PM' }));
assert.match(timeOnly.response.candidate.sms_response, /What day/);
assert.doesNotMatch(timeOnly.response.candidate.sms_response, /what time/i);
const noSlot = runSafe(malformed, visit({ signal: 'INTEREST', date: null, time: null }));
assert.match(noSlot.response.candidate.sms_response, /What day and time/);
assert.equal(noSlot.response.candidate.booking_date, null);
assert.equal(noSlot.response.candidate.booking_time, null);

// Store-hours states are explicit prompt constraints, including missing timezone behavior.
assert.match(prompt, /CONFIGURED or UPSTREAM_FALLBACK/);
assert.match(prompt, /UNAVAILABLE or UPSTREAM_MALFORMED/);
assert.match(prompt, /CONFIGURED_NO_ACTIVE_HOURS/);
assert.match(prompt, /store_hours_status is missing but nonempty store_hours or store_hours_text is supplied/);
assert.match(prompt, /If status and hours are both missing, treat hours conservatively like UNAVAILABLE/);
assert.match(prompt, /If timezone is missing, do not convert, infer, or label a timezone/);

// Model/API failures use a route-safe deterministic fallback; unsupported routes fail with a null candidate.
const apiFailure = runSafe({ error: 'provider unavailable' });
assert.equal(apiFailure.response.generation.status, 'fallback');
assert.ok(apiFailure.response.generation.warnings.includes('MODEL_CALL_FAILED'));
assert.ok(apiFailure.response.candidate.sms_response);
const malformedGeneral = runSafe(malformed);
assert.equal(malformedGeneral.response.generation.status, 'fallback');
assert.ok(malformedGeneral.response.generation.warnings.includes('MALFORMED_RESPONSE_JSON'));
const malformedKnownInventory = runSafe(malformed, {
  decision: {
    route: 'INVENTORY', inventory_claim_mode: 'availability_unverified', cta_type: 'verify_availability',
    allowed_facts: { vehicle: { year: '2023', make: 'BMW', model: '5 Series' }, inventory: { status: 'UNKNOWN', exact_matches: [{ vin: 'VIN530' }] } }
  }
});
assert.match(malformedKnownInventory.response.candidate.sms_response, /2023 BMW 5 Series/);
assert.doesNotMatch(malformedKnownInventory.response.candidate.sms_response, /Which vehicle/i);
const unsupported = runSafe(malformed, { decision: { route: 'UNSUPPORTED' } });
assert.equal(unsupported.response.candidate.sms_response, null);
assert.equal(unsupported.response.generation.status, 'failed');

assert.equal(workflow.active, false);
console.log('Response Generator regression checks passed (24 focused cases covered).');
