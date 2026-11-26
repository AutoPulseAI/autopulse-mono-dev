import Vehicle from '../models/Vehicle.js';

// The one search box: a lead matches when its name or email contains the text, its phone contains the digits typed
// (3 or more), or the text is (part of) the stock number of a car in the dealer's inventory that the lead is about.
export async function oneBoxConditions(q, dealerId) {
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = esc(q);
  const conds = [{ name: { $regex: text, $options: 'i' } }, { email: { $regex: text, $options: 'i' } }];
  let digits = q.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length >= 3 && /^[\d\s()+.-]+$/.test(q)) conds.push({ phone: { $regex: digits.split('').join('[^0-9]*') } });
  if (/^[a-z0-9-]{2,}$/i.test(q)) {
    // The inventory import stores stockNumber (app/lib/import.js); older / seeded records have stocknumber / stock_number.
    const starts = { $regex: `^${text}`, $options: 'i' };
    const cars = await Vehicle.find({ dealerId: String(dealerId), $or: [{ stockNumber: starts }, { stocknumber: starts },
      { stock_number: starts }] }).select('vin').limit(50).lean();
    const vins = [...new Set(cars.map((v) => v.vin).filter(Boolean))];
    if (vins.length) conds.push({ vin: { $in: vins } }, { 'vehicles_of_interest.vin': { $in: vins } });
    conds.push({ 'vehicles_of_interest.stock': { $regex: `^${text}$`, $options: 'i' } });
  }
  return conds;
}
