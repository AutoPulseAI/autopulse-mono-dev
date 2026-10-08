// Manager alerts (client, 8 Oct 2026): app/lib/ai/managerAlerts.js. Run: node test-manager-alerts.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertText, notifyManagers, MANAGER_ALERT_NOTE_KINDS, alertForStatus } from './app/lib/ai/managerAlerts.js';

const quiet = { warn() {}, error() {} };
const lead = { first_name: 'Maria', last_name: 'Lopez', phone: '+15551234567', email: 'maria@example.com' };

test('the manager gets an email and a text, with the lead and a link', async () => {
  const sent = { email: [], sms: [] };
  const result = await notifyManagers({ dealerId: 'd1', leadId: 'l1', title: 'A lead needs a manager', detail: 'Upset' }, {
    findDealer: async () => ({ dealer_account_information: { general_manager_email: 'gm@dealer.com', general_manager_phone: '+15550001111' } }),
    findLead: async () => lead, findSender: async () => ({ email_address: 'leads@dealer.com' }),
    email: async (...a) => sent.email.push(a), sms: async (...a) => sent.sms.push(a), logger: quiet, baseUrl: 'https://crm',
  });
  assert.equal(result.status, 'sent');
  assert.equal(sent.email[0][0], 'gm@dealer.com');
  assert.match(sent.email[0][2], /Maria Lopez[\s\S]*Upset[\s\S]*https:\/\/crm\/dealer\/leads\?lead=l1/);
  assert.equal(sent.sms[0][0], '+15550001111');
  assert.ok(sent.sms[0][1].length <= 320);
});

test('no manager phone: the store number gets the text; no contact at all: skipped, never throws', async () => {
  const sms = [];
  await notifyManagers({ dealerId: 'd1', leadId: 'l1', title: 'x' }, {
    findDealer: async () => ({ dealer_account_information: { store_contact_number: '+15559990000' } }),
    findLead: async () => lead, findSender: async () => null, email: async () => {}, sms: async (to) => sms.push(to), logger: quiet,
  });
  assert.deepEqual(sms, ['+15559990000']);
  const none = await notifyManagers({ dealerId: 'd1', leadId: 'l1', title: 'x' }, {
    findDealer: async () => ({ dealer_account_information: {} }), findLead: async () => lead, logger: quiet,
  });
  assert.equal(none.status, 'skipped');
  const broken = await notifyManagers({ dealerId: 'd1', leadId: 'l1', title: 'x' }, {
    findDealer: async () => { throw new Error('db down'); }, findLead: async () => lead, logger: quiet,
  });
  assert.equal(broken.status, 'failed');
});

test('which alerts notify', () => {
  assert.deepEqual(Object.keys(MANAGER_ALERT_NOTE_KINDS).sort(), ['after_handoff', 'call_escalation', 'not_interested']);
  assert.ok(alertForStatus('Managerial Review'));
  assert.equal(alertForStatus('Contacted'), null);
  assert.match(alertText({ title: 'T', lead: {}, link: 'L' }).sms, /a customer/);
});
