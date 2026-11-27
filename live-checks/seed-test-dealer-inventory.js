// Test dealership "Rapidsai" (the user, 28 Nov 2026): fill its inventory with copies of cars from the other stores so
// testers have real-looking stock (stock #, photos, prices) to search, attach to messages and see on reports.
//
// DRY RUN by default: prints what it would copy and changes nothing. With APPLY=1 it writes:
//   - inserts copies into `vehicles` with dealerId = the test dealership, each marked
//       test_copy: { from_dealer, from_vehicle, at }   (so they can be found and removed later);
//   - nothing else: other stores' cars are only read, never changed; no lead, customer or message is touched.
// It refuses to run unless the target account is a dealership whose AI is off (ai_mode "off"), so the copied cars can
// never end up in a message to a real customer.
//
// Run on the web server:
//   cd /var/www/html/autopulse-prod-v2/aidmvcs-be-dev
//   export URI="$(grep -hE '^MONGODB_URI=' .env* | head -1 | cut -d= -f2- | tr -d '"')"
//   mongosh "$URI" --quiet --eval 'var EMAIL="rapidsai23@gmail.com", PER_STORE=40' /tmp/seed-test-dealer-inventory.js
//   mongosh "$URI" --quiet --eval 'var EMAIL="rapidsai23@gmail.com", PER_STORE=40, APPLY=1' /tmp/seed-test-dealer-inventory.js
// Undo (removes only the copies):  db.vehicles.deleteMany({ dealerId: "<test dealer id>", "test_copy.from_dealer": { $exists: true } })
/* global EMAIL, PER_STORE, APPLY */
const email = (typeof EMAIL !== 'undefined' ? EMAIL : 'rapidsai23@gmail.com').toLowerCase().trim();
const perStore = typeof PER_STORE !== 'undefined' ? Math.max(1, Math.min(500, Number(PER_STORE) || 40)) : 40;
const apply = typeof APPLY !== 'undefined' && String(APPLY) === '1';

const test = db.users.findOne({ email }, { name: 1, type: 1, parent_id: 1, ai_mode: 1 });
if (!test) { print(`No account with email ${email}. Create the dealership first (Admin > Dealers > Add dealer).`); quit(1); }
if (test.type !== 'dealer' || test.parent_id) { print(`${email} is not a dealership account (type ${test.type}, parent ${test.parent_id}). Stopping.`); quit(1); }
if ((test.ai_mode || 'off') !== 'off') { print(`${test.name}: AI is "${test.ai_mode}" - turn it off before adding test stock. Stopping.`); quit(1); }
const testId = String(test._id);
print(`Test dealership: ${test.name} (${testId}), AI ${test.ai_mode || 'off'}; ${perStore} cars per store; ${apply ? 'WRITING' : 'dry run - nothing written'}`);

const have = new Set(db.vehicles.distinct('vin', { dealerId: testId }).map((v) => String(v).toUpperCase()));
let planned = 0;
const stores = db.vehicles.distinct('dealerId', { dealerId: { $ne: testId } });
for (const storeId of stores) {
  let storeName = storeId;
  try { const u = db.users.findOne({ _id: ObjectId(String(storeId)) }, { name: 1 }); if (u) storeName = u.name; } catch (e) { /* not an ObjectId */ }
  // Newest cars with a VIN first; one copy per VIN across all stores.
  const cars = db.vehicles.find({ dealerId: storeId, removedAt: null, vin: { $exists: true, $nin: [null, ''] } }).sort({ updatedAt: -1 }).limit(perStore * 3).toArray();
  // Running it again tops each store up to PER_STORE; it never keeps adding.
  const already = db.vehicles.countDocuments({ dealerId: testId, 'test_copy.from_dealer': String(storeId) });
  const need = Math.max(0, perStore - already);
  const pick = [];
  for (const c of cars) {
    if (pick.length >= need) break;
    const vin = String(c.vin).toUpperCase();
    if (have.has(vin)) continue;
    have.add(vin);
    pick.push(c);
  }
  planned += pick.length;
  print(`  ${storeName}: ${pick.length} cars to add (${already} already copied)`);
  if (!apply || !pick.length) continue;
  const now = new Date();
  const docs = pick.map((c) => {
    const { _id, removedAt, ...rest } = c; // only cars still in stock; never copy a "gone" mark (it hides the car)
    return { ...rest, dealerId: testId, test_copy: { from_dealer: String(storeId), from_vehicle: String(_id), at: now }, createdAt: now, updatedAt: now };
  });
  try { db.vehicles.insertMany(docs, { ordered: false }); }
  catch (e) { print(`    some not added: ${e.message.slice(0, 200)}`); }
}
print(apply ? `Done: ${db.vehicles.countDocuments({ dealerId: testId })} cars now in ${test.name}.` : `Would copy ${planned} cars from ${stores.length} stores. Run again with APPLY=1 to write.`);
