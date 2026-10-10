// Owner leads for DealerVault customers with no lead (client, 9 Oct 2026): app/lib/ai/aiOwnerLead.js.
// Run: node test-owner-lead.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureOwnerLead, validateOwnerLeadPayload } from './app/lib/ai/aiOwnerLead.js';
import { statusLabel } from './app/lib/statusLabels.js';

const CID = '66f0000000000000000000bb';
const lean = (v) => ({ lean: async () => v, sort() { return this; } });

function models({ customer, existing = null }) {
  const created = [];
  return {
    created,
    Customer: { findOne: () => lean(customer) },
    Lead: {
      findOne: () => ({ sort: () => lean(existing) }),
      create: async (doc) => { created.push(doc); return { _id: 'newlead', ...doc }; },
    },
  };
}

test('a customer with no lead gets a Sold Delivered owner lead from DealerVault', async () => {
  const m = models({ customer: { name: 'Owen', emails: [{ value: 'o@x.test', is_primary: true }],
    phones: [{ value: '+12015550111' }] } });
  const result = await ensureOwnerLead({ dealer_id: 'd1', customer_id: CID, deal_number: 'D1' }, m);
  assert.deepEqual(result, { found: true, created: true, lead_id: 'newlead' });
  assert.equal(m.created[0].fe_lead_status, 'Sold Delivered');
  assert.equal(m.created[0].source, 'DealerVault');
  assert.equal(m.created[0].phone, '+12015550111');
  assert.equal(m.created[0].data.owner_lead, true);
});

test('an existing lead is returned, never a second one', async () => {
  const m = models({ customer: { name: 'Owen' }, existing: { _id: 'old' } });
  const result = await ensureOwnerLead({ dealer_id: 'd1', customer_id: CID }, m);
  assert.deepEqual(result, { found: true, created: false, lead_id: 'old' });
  assert.equal(m.created.length, 0);
});

test('unknown customer and bad payloads', async () => {
  assert.deepEqual(await ensureOwnerLead({ dealer_id: 'd1', customer_id: CID }, models({ customer: null })), { found: false });
  assert.ok(validateOwnerLeadPayload({ dealer_id: 'd1' }).errors.length);
  assert.equal(validateOwnerLeadPayload({ dealer_id: 'd1', customer_id: CID }).errors.length, 0);
});

test('statuses show the PDF names; stored values unchanged', () => {
  assert.equal(statusLabel('Visited'), 'Sales Visit');
  assert.equal(statusLabel('Appointment Booked'), 'Appointment Set');
  assert.equal(statusLabel('Lead Not Contacted'), 'No Contact Made');
  assert.equal(statusLabel('Sold Pending'), 'Sold Pending');
});
