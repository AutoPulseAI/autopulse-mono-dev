// IP restriction (app/lib/ipRestriction.js): matching, the visitor's IP, test mode vs enforce, who is never restricted.
// Run: node --test test-ip-restriction.mjs   (no database: the dealership's rule is passed in)
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

mongoose.set('bufferCommands', false); // the "would block" record fails fast without a database (it is best effort)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { ipAllowed, parseEntry, requestIp, ipBlocked, viaLoginAs } = await import('./app/lib/ipRestriction.js');

const req = (ip, token) => ({ headers: new Headers({ ...(ip ? { 'x-real-ip': ip } : {}),
  ...(token ? { authorization: `Bearer ${token}` } : {}) }) });
const staff = { _id: new mongoose.Types.ObjectId(), type: 'dealer', parent_id: new mongoose.Types.ObjectId(), name: 'Mercy' };
const owner = { _id: new mongoose.Types.ObjectId(), type: 'dealer', parent_id: null, name: 'Store' };
const LIST = [{ value: '203.0.113.0/24' }, { value: '198.51.100.7' }, { value: '2001:db8::/48' }];
const TEST = { list: LIST, mode: 'test' };
const ENFORCE = { list: LIST, mode: 'enforce' };

test('entries: single IPs and ranges, v4 and v6; nonsense refused', () => {
  assert.deepEqual(parseEntry('198.51.100.7'), { address: '198.51.100.7', prefix: 32, family: 'ipv4' });
  assert.equal(parseEntry('203.0.113.0/24').prefix, 24);
  assert.equal(parseEntry('2001:db8::/48').family, 'ipv6');
  for (const bad of ['', 'abc', '1.2.3.4/33', '1.2.3.4/4', '1.2.3.4/24x', '1.2.3.4/24/1', '300.1.1.1']) assert.equal(parseEntry(bad), null, bad);
});

test('matching', () => {
  assert.equal(ipAllowed('203.0.113.200', LIST), true);
  assert.equal(ipAllowed('::ffff:198.51.100.7', LIST), true); // IPv4 seen as IPv6
  assert.equal(ipAllowed('2001:db8:0:ff::1', LIST), true);
  assert.equal(ipAllowed('203.0.114.1', LIST), false);
  assert.equal(ipAllowed('8.8.8.8', LIST), false);
  assert.equal(ipAllowed('not-an-ip', LIST), false);
});

test("the visitor's IP is nginx's X-Real-IP only (X-Forwarded-For can be typed by anyone)", () => {
  assert.equal(requestIp(req('203.0.113.9')), '203.0.113.9');
  assert.equal(requestIp({ headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }) }), null);
  assert.equal(requestIp(req()), null);
});

test('test mode never blocks, from inside or outside the list', async () => {
  assert.equal(await ipBlocked(req('203.0.113.9'), staff, { rule: TEST }), false);
  assert.equal(await ipBlocked(req('8.8.8.8'), staff, { rule: TEST }), false);
  assert.equal(await ipBlocked(req('8.8.8.8'), owner, { rule: TEST }), false);
});

test('enforce blocks the dealership\'s own users outside the list, never inside it', async () => {
  assert.equal(await ipBlocked(req('8.8.4.4'), staff, { rule: ENFORCE }), true);
  assert.equal(await ipBlocked(req('8.8.4.5'), owner, { rule: ENFORCE }), true);
  assert.equal(await ipBlocked(req('203.0.113.9'), staff, { rule: ENFORCE }), false);
});

test('never restricted: no list, no visible IP, super admins, agencies, "login as"', async () => {
  assert.equal(await ipBlocked(req('8.8.8.8'), staff, { rule: { list: [], mode: 'enforce' } }), false);
  assert.equal(await ipBlocked(req(), staff, { rule: ENFORCE }), false);
  assert.equal(await ipBlocked(req('8.8.8.8'), { _id: 'a', type: 'admin' }, { rule: ENFORCE }), false);
  assert.equal(await ipBlocked(req('8.8.8.8'), { _id: 'v', type: 'vendor' }, { rule: ENFORCE }), false);
  const loginAs = jwt.sign({ userId: String(owner._id), type: 'dealer', impersonated_by: 'admin1', impersonator_type: 'admin' }, process.env.JWT_SECRET);
  assert.equal(viaLoginAs(req('8.8.8.8', loginAs)), true);
  assert.equal(await ipBlocked(req('8.8.8.8', loginAs), owner, { rule: ENFORCE }), false);
  const own = jwt.sign({ userId: String(owner._id), type: 'dealer' }, process.env.JWT_SECRET);
  assert.equal(viaLoginAs(req('8.8.8.8', own)), false);
});
