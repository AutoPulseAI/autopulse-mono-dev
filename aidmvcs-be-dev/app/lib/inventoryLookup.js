// Find cars in a dealer's inventory by stock # or VIN (what staff type: 2788C, a full VIN or part of one).
// Used by the Desk Log check-in (api/desk-log/stock) and the lead card's VIN box (api/inventory/lookup).
// Cars the latest feed no longer has (removedAt) are left out. The inventory import stores camelCase fields
// (lib/import.js): stockNumber, vin, year, make, model, trim. Exact stock # first, then stock # starting with it,
// then the rest; at most `limit`.
import Vehicle from '../models/Vehicle.js';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function lookupInventory(dealerId, text, { limit = 8 } = {}) {
  const q = String(text || '').replace(/\s+/g, '').slice(0, 40);
  if (q.length < 2) return [];
  const has = new RegExp(escape(q), 'i');
  const cars = await Vehicle.find({ dealerId: String(dealerId), removedAt: null, $or: [{ stockNumber: has }, { vin: has }] })
    .select('stockNumber vin year make model trim condition exteriorColor mileage internetSpecial internetReduced')
    .limit(40).lean();
  const starts = new RegExp(`^${escape(q)}`, 'i');
  const rank = (c) => (String(c.stockNumber || '').toLowerCase() === q.toLowerCase() || String(c.vin || '').toLowerCase() === q.toLowerCase() ? 0
    : starts.test(String(c.stockNumber || '')) || starts.test(String(c.vin || '')) ? 1 : 2);
  cars.sort((a, b) => rank(a) - rank(b) || String(a.stockNumber || '').localeCompare(String(b.stockNumber || '')));
  return cars.slice(0, limit).map((c) => ({ stock_number: c.stockNumber ? String(c.stockNumber) : null,
    vin: c.vin ? String(c.vin).toUpperCase() : null, year: Number(c.year) || null, make: c.make || null,
    model: c.model || null, trim: c.trim || null, condition: c.condition || null, color: c.exteriorColor || null,
    mileage: Number(c.mileage) || null, price: Number(c.internetReduced || c.internetSpecial) || null }));
}
