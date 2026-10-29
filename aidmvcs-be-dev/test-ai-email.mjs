// AI emails (28 Oct 2026 meeting): layout, signature, unsubscribe and open links.   Run: node --test test-ai-email.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.EMAIL_LINK_SECRET = 'test-secret';
const { createBrandedEmailTemplate } = await import('./app/lib/email.js');
const { emailLinks, validKey, signKey } = await import('./app/lib/ai/emailTracking.js');
const victory = { dealer_account_information: { store_name: 'Victory Cars Central', store_website: 'www.victorycarscentral.com',
  store_address: ' 3914 Hempstead Tpke', store_city: 'Levittown', store_state: 'NY', ai_bot_name: 'Nicole',
  sms_conversion_phone: '+13476585466', trade_in_appraisal_url: 'https://www.victorycarscentral.com/value-your-trade/' } };

test('an AI email has a signature, real links, the address and an unsubscribe link (28 Oct 2026 meeting)', () => {
  const links = emailLinks('lead-1:email', 'https://autopulse.ai');
  const html = createBrandedEmailTemplate('<p>Hi Brian,</p><p>Would Saturday work?</p>', victory, links);
  for (const part of ['Nicole', 'Victory Cars Central', '3914 Hempstead Tpke, Levittown, NY', 'tel:+13476585466',
    'https://www.victorycarscentral.com', 'Visit our website', 'Value your trade', 'Unsubscribe', links.unsubscribeUrl,
    links.openPixelUrl]) assert.ok(html.includes(part.replace(/&/g, '&amp;')), part);
  assert.ok(!html.includes('See our inventory'));
  assert.ok(!html.includes('"> 3914'), 'the stray space is trimmed');
});

test('a link only works with its own signature', () => {
  assert.ok(validKey('lead-1:email', signKey('lead-1:email')));
  assert.ok(!validKey('lead-2:email', signKey('lead-1:email')));
  assert.ok(!validKey('lead-1:email', 'forged'));
  assert.deepEqual(emailLinks('k', ''), {});  // no public address configured: the email still goes, without links
});

test('an email without links (staff, campaigns) is unchanged', () => {
  const html = createBrandedEmailTemplate('<p>Hi</p>', victory);
  assert.ok(!html.includes('Unsubscribe') && !html.includes('/api/email/open'));
});

test('SES events: delivered, bounced, spam, opened, clicked (30 Oct 2026)', async () => {
  const { sesEventUpdate } = await import('./app/lib/ai/sesEvents.js');
  assert.equal(sesEventUpdate({ eventType: 'Delivery', delivery: {} })[0].$set.status, 'delivered');
  assert.deepEqual(sesEventUpdate({ eventType: 'Bounce', bounce: { bounceType: 'Permanent' } })[1], 'suppress_bounce');
  assert.equal(sesEventUpdate({ eventType: 'Bounce', bounce: { bounceType: 'Transient' } })[1], null);
  assert.equal(sesEventUpdate({ eventType: 'Complaint', complaint: {} })[1], 'suppress_complaint');
  assert.equal(sesEventUpdate({ eventType: 'Open', open: {} })[0].$inc.open_count, 1);
  assert.ok(sesEventUpdate({ eventType: 'Click', click: { link: 'https://x' } })[0].$min.clicked_at);
  assert.deepEqual(sesEventUpdate({ eventType: 'Send' }), [null, null]);
});

test('an SNS message is accepted only with Amazon\'s signature', async () => {
  const crypto = await import('crypto');
  const { snsStringToSign, verifySnsMessage, validCertUrl } = await import('./app/lib/ai/sesEvents.js');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const msg = { Type: 'Notification', MessageId: 'm1', TopicArn: 'arn:aws:sns:us-east-1:1:ses-events',
    Message: '{"eventType":"Open"}', Timestamp: '2026-10-30T00:00:00Z', SignatureVersion: '2',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem' };
  msg.Signature = crypto.createSign('RSA-SHA256').update(snsStringToSign(msg)).sign(privateKey, 'base64');
  const fetchCert = async () => pem;
  assert.equal(await verifySnsMessage(msg, { fetchCert, topicArn: msg.TopicArn }), true);
  assert.equal(await verifySnsMessage({ ...msg, Message: '{"eventType":"Click"}' }, { fetchCert, topicArn: msg.TopicArn }), false);
  assert.equal(await verifySnsMessage(msg, { fetchCert, topicArn: 'arn:aws:sns:us-east-1:1:other' }), false);
  assert.equal(validCertUrl('https://evil.example.com/x.pem'), false);
});

test('the email\'s status in the conversation: spam, bounced, clicked, opened, delivered', async () => {
  const { messageStatusLabel } = await import('./app/lib/messageAuthor.js');
  assert.equal(messageStatusLabel({ status: 'bounced', email_event: 'bounced' }), 'Bounced');
  assert.equal(messageStatusLabel({ status: 'sent', email_event: 'complaint' }), 'Marked as spam');
  assert.equal(messageStatusLabel({ status: 'delivered', opened_at: new Date(), clicked_at: new Date() }), 'Clicked');
  assert.equal(messageStatusLabel({ status: 'delivered', opened_at: new Date() }), 'Opened');
  assert.equal(messageStatusLabel({ status: 'delivered' }), 'Delivered');
});
