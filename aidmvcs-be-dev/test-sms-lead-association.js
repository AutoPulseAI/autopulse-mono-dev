import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeSmsPhone } from './app/lib/sms.js';
import { EMAIL_CONVERSATION_INDEX, EMAIL_SMS_PAIR_INDEX } from './app/models/Email.js';
import { ensureEmailIndexes } from './scripts/ensure-email-indexes.js';

const dealerId = '68e6f270ac63d8a8eba32096';
const otherDealerId = '68e6f270ac63d8a8eba32097';
const leadId = '6aaf06c411a1f154d049a812';
const dealerPhone = '+13476585466';
const customerPhone = '+15167543762';

function matchesSmsHistory(query, message) {
  return String(message.dealer_id) === query.dealer_id
    && message.communication_type === query.communication_type
    && message.lead_id != null
    && query.$or.some(pair => message.sender === pair.sender && message.recipient === pair.recipient);
}

async function runWebhook(messages = []) {
  const code = await readFile(new URL('./app/api/system/sms/route.js', import.meta.url), 'utf8');
  const source = code
    .replace(/^import .*;.*$/gm, '')
    .replace('export async function POST', 'async function POST');
  const captured = { jobs: [] };
  const Email = {
    findOne(query) {
      captured.query = query;
      return {
        async sort(spec) {
          captured.sort = spec;
          return messages.filter(message => matchesSmsHistory(query, message)).sort((a, b) =>
            b.timestamp - a.timestamp || String(b._id).localeCompare(String(a._id)))[0] || null;
        },
      };
    },
  };
  class WebhookLog { async save() {} }
  class Redis {}
  class Queue {
    async add(name, data) { captured.jobs.push({ name, data }); }
  }
  const dealer = { _id: dealerId, package_expiry: new Date(Date.now() + 86400000) };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    process: { env: {} },
    Response,
    dbConnect: async () => {},
    Email,
    WebhookLog,
    Queue,
    Redis,
    User: { findOne: async () => dealer, findById: async () => null },
    sendSubscriptionExpiryNotification: async () => {},
    isPackageExpiryValid: () => true,
  });
  vm.runInContext(`${source}\nthis.run = POST;`, context);
  const fields = new Map(Object.entries({
    From: customerPhone,
    To: dealerPhone,
    Body: 'Yes, that works',
    MessageSid: 'SM-inbound',
    SmsStatus: 'received',
    NumMedia: '0',
    AccountSid: 'AC-test',
  }));
  const response = await context.run({ formData: async () => fields, headers: new Headers() });
  assert.equal(response.status, 200);
  return { ...captured, currentSMS: captured.jobs[0].data.currentSMS };
}

test('reverse-direction outbound SMS supplies lead and existing root', async () => {
  const result = await runWebhook([
    { _id: '1', dealer_id: dealerId, sender: dealerPhone, recipient: customerPhone,
      communication_type: 'sms', lead_id: 'older-lead', message_id: 'SM-older', timestamp: new Date('2026-01-01') },
    { _id: '2', dealer_id: dealerId, sender: dealerPhone, recipient: customerPhone,
      communication_type: 'sms', lead_id: leadId, message_id: 'SM-outbound',
      parent_message_id: 'conversation-root', parent_conversation: 'older-root', timestamp: new Date('2026-01-02') },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.query)), {
    dealer_id: dealerId,
    communication_type: 'sms',
    lead_id: { $exists: true, $ne: null },
    $or: [
      { sender: dealerPhone, recipient: customerPhone },
      { sender: customerPhone, recipient: dealerPhone },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.sort)), { timestamp: -1, _id: -1 });
  assert.equal(result.currentSMS.lead_id, leadId);
  assert.equal(result.currentSMS.parent_message_id, 'conversation-root');
  assert.equal(result.currentSMS.parent_conversation, 'conversation-root');
});

test('same-pair inbound history works and parent_conversation is the root fallback', async () => {
  const result = await runWebhook([{
    _id: '1', dealer_id: dealerId, sender: customerPhone, recipient: dealerPhone,
    communication_type: 'sms', lead_id: leadId, message_id: 'SM-prior-inbound',
    parent_conversation: 'conversation-root', timestamp: new Date('2026-01-01'),
  }]);
  assert.equal(result.currentSMS.lead_id, leadId);
  assert.equal(result.currentSMS.parent_message_id, 'conversation-root');
  assert.equal(result.currentSMS.parent_conversation, 'conversation-root');
});

test('message_id is used only when an existing root is absent', async () => {
  const result = await runWebhook([{
    _id: '1', dealer_id: dealerId, sender: dealerPhone, recipient: customerPhone,
    communication_type: 'sms', lead_id: leadId, message_id: 'SM-outbound', timestamp: new Date('2026-01-01'),
  }]);
  assert.equal(result.currentSMS.parent_message_id, 'SM-outbound');
  assert.equal(result.currentSMS.parent_conversation, 'SM-outbound');
});

test('other-dealer and unlinked SMS history cannot associate an inbound message', async () => {
  for (const history of [
    [{ dealer_id: otherDealerId, sender: dealerPhone, recipient: customerPhone,
      communication_type: 'sms', lead_id: leadId, message_id: 'SM-other', timestamp: new Date() }],
    [{ dealer_id: dealerId, sender: dealerPhone, recipient: customerPhone,
      communication_type: 'sms', lead_id: null, message_id: 'SM-orphan', timestamp: new Date() }],
  ]) {
    const result = await runWebhook(history);
    assert.equal(result.currentSMS.lead_id, undefined);
    assert.equal(result.currentSMS.parent_message_id, undefined);
    assert.equal(result.currentSMS.parent_conversation, null);
  }
});

test('no SMS history leaves association unresolved without Lead phone fallback', async () => {
  const result = await runWebhook([]);
  assert.equal(result.currentSMS.lead_id, undefined);
  assert.equal(result.currentSMS.parent_message_id, undefined);
  assert.equal(result.currentSMS.parent_conversation, null);
});

async function runWorker(n8nPost, { resolved = true } = {}) {
  const code = await readFile(new URL('./app/worker/processSms.js', import.meta.url), 'utf8');
  const source = code
    .replace(/^import .*;.*$/gm, '')
    .replace('await dbConnect();', '')
    .replace('export async function processSMS', 'async function processSMS');
  const saved = [];
  let createdLeads = 0;
  const createdLeadDocuments = [];
  class Email {
    constructor(document) { Object.assign(this, document); }
    async save() { saved.push({ ...this }); }
    static async findOne() { return null; }
    static async findOneAndUpdate() { return null; }
  }
  const dealer = { setting: { autoReplyEnabled: false }, dealer_account_information: {} };
  class Lead {
    constructor(document) {
      Object.assign(this, document);
      createdLeads++;
      createdLeadDocuments.push(document);
    }
    async save() { return { ...this, _id: 'duplicate-lead' }; }
    static async findById(id) { return { _id: id, email: null, phone: customerPhone }; }
    static async findByIdAndUpdate() { return null; }
  }
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    process: { env: { N8N_SMS_API: 'https://n8n.example.test/sms' } },
    axios: { post: n8nPost },
    Email,
    Lead,
    User: { findOne: async () => dealer, findById: async () => dealer },
    EmailAccount: { findOne: () => ({ collation: async () => ({ email_address: 'leads@example.test' }) }) },
    FollowUpJob: { findOne: async () => null },
    processAndUploadMedia: async () => null,
    sendEmail: async () => null,
    sendSMS: async () => null,
    onLeadStatusChange: async () => {},
    onFollowUpEvent: async () => {},
    checkLeadByIdentifiers: async () => ({ success: false }),
    cancelAllRemindersForLead: async () => {},
    createAppointmentReminders: async () => {},
    createManagerialReviewMessages: async () => {},
    linkCustomerToLead: async () => {},
    isEmailSentinel: () => false,
    normalizeSmsPhone,
    moment: () => ({ tz: () => ({ format: () => '' }) }),
    dbConnect: async () => {},
  });
  vm.runInContext(`${source}\nthis.run = processSMS;`, context);
  await context.run({ data: { currentSMS: {
    message_id: 'SM-inbound', sender: customerPhone, recipient: dealerPhone,
    dealer_id: dealerId, communication_type: 'sms', status: 'received',
    mail_content: 'Yes', NumMedia: 0,
    lead_id: resolved ? leadId : null,
    parent_message_id: resolved ? 'conversation-root' : null,
    parent_conversation: resolved ? 'conversation-root' : null,
  } } });
  return { saved, createdLeads, createdLeadDocuments };
}

test('n8n failure cannot erase webhook-resolved lead or conversation root', async () => {
  const { saved, createdLeads } = await runWorker(async () => { throw new Error('n8n 500'); });
  assert.ok(saved.length >= 1);
  assert.equal(createdLeads, 0);
  assert.equal(saved[0].message_id, 'SM-inbound');
  assert.equal(saved[0].lead_id, leadId);
  assert.equal(saved[0].parent_message_id, 'conversation-root');
  assert.equal(saved[0].parent_conversation, 'conversation-root');
});

test('n8n create_lead=true cannot replace a webhook-resolved Lead', async () => {
  const { saved, createdLeads } = await runWorker(async () => ({ data: {
    create_lead: true,
    lead_name: 'Duplicate Candidate',
    lead_phone: '(516) 754-3762',
    response_mode: 'sms',
    Response: 'Thanks',
  } }));
  assert.equal(createdLeads, 0);
  assert.equal(saved[0].lead_id, leadId);
  assert.equal(saved[0].parent_message_id, 'conversation-root');
});

test('new n8n-created SMS Leads store valid phone numbers in E.164', async () => {
  const result = await runWorker(async () => ({ data: {
    create_lead: true,
    lead_name: 'New Lead',
    lead_phone: '(516) 754-3762',
    lead_source: 'sms',
    response_mode: 'sms',
    user_language: 'english',
    Response: 'Thanks',
  } }), { resolved: false });
  assert.equal(result.createdLeads, 1);
  assert.equal(result.createdLeadDocuments[0].phone, '+15167543762');
});

test('SMS phone normalization uses the same E.164 representation as Twilio', () => {
  assert.equal(normalizeSmsPhone('(516) 754-3762'), '+15167543762');
  assert.equal(normalizeSmsPhone('15167543762'), '+15167543762');
  assert.throws(() => normalizeSmsPhone('12345'), /Invalid phone number format/);
});

test('email index rollout checks and creates the SMS pair index idempotently', async () => {
  const indexes = [{ key: EMAIL_CONVERSATION_INDEX.key, ...EMAIL_CONVERSATION_INDEX.options }];
  const created = [];
  const connection = { collection: () => ({
    listIndexes: () => ({ toArray: async () => indexes }),
    createIndex: async (key, options) => {
      created.push({ key, options });
      indexes.push({ key, ...options });
    },
  }) };
  assert.equal(await ensureEmailIndexes(connection), 1);
  assert.equal(await ensureEmailIndexes(connection, true), 0);
  assert.equal(await ensureEmailIndexes(connection, true), 0);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], { key: EMAIL_SMS_PAIR_INDEX.key, options: EMAIL_SMS_PAIR_INDEX.options });
});
