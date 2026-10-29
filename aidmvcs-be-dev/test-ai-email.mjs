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
