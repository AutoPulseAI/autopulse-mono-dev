// Stock # lookup at the Desk Log check-in (13 Nov 2026 meeting, 26:45 / 44:40: typing a stock number like 2788C pulls
// up the car from the dealer's inventory). ?dealer_id &q (stock # or VIN, 2+ characters) -> up to 8 cars in stock:
// stock numbers starting with q first, then stock numbers / VINs containing it. Cars the latest feed no longer has
// (removedAt) are left out. The inventory import stores camelCase fields (lib/import.js): stockNumber, vin, year...
import Vehicle from '@models/Vehicle';
import { deskLogAccess, json } from '@lib/deskLog/access';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id');
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  const q = (params.get('q') || '').replace(/\s+/g, '').slice(0, 40);
  if (q.length < 2) return json({ cars: [] });
  const has = new RegExp(escape(q), 'i');
  const cars = await Vehicle.find({ dealerId: String(dealerId), removedAt: null,
    $or: [{ stockNumber: has }, { vin: has }] })
    .select('stockNumber vin year make model trim condition exteriorColor mileage internetSpecial internetReduced')
    .limit(40).lean();
  const starts = new RegExp(`^${escape(q)}`, 'i');
  const rank = (c) => (String(c.stockNumber || '').toLowerCase() === q.toLowerCase() ? 0
    : starts.test(String(c.stockNumber || '')) ? 1 : 2);
  cars.sort((a, b) => rank(a) - rank(b) || String(a.stockNumber || '').localeCompare(String(b.stockNumber || '')));
  return json({ cars: cars.slice(0, 8).map((c) => ({ stock_number: c.stockNumber ? String(c.stockNumber) : null,
    vin: c.vin ? String(c.vin).toUpperCase() : null, year: Number(c.year) || null, make: c.make || null,
    model: c.model || null, trim: c.trim || null, condition: c.condition || null, color: c.exteriorColor || null,
    mileage: Number(c.mileage) || null, price: Number(c.internetReduced || c.internetSpecial) || null })) });
}
