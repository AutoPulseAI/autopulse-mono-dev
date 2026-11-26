// The facts of one inventory car that staff can put in a reply (Betsy, 25 Nov 2026: "vehicle year, make, model, miles,
// drive train, fuel type - all the stuff that's in the inventory feed ... pull those things into my conversation").
// The import (lib/import.js) and older feeds name fields differently (stockNumber / stocknumber / stock_number,
// imagesSecure / imageUrls ...), so each fact reads every spelling. No framework imports: the node tests import it.
const first = (v, keys) => keys.map((k) => v?.[k]).find((x) => x !== undefined && x !== null && String(x).trim() !== '');

function list(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(value.includes('|') ? '|' : ',');
  return [];
}

const money = (n) => (Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : null);

/** { title, photos: [https...], facts: [{ key, label, value, text }] } - `text` is what goes in the message. */
export function vehicleFacts(v) {
  if (!v) return { title: '', photos: [], facts: [] };
  const title = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
  const photos = [...new Set(list(first(v, ['imagesSecure', 'imageUrls', 'imageurls', 'photoUrls', 'photourls']))
    .map((u) => String(u).trim()).filter((u) => /^https:\/\//i.test(u)))];
  const price = money(Number(first(v, ['internetPrice', 'internetprice', 'internetReduced', 'internetreduced',
    'internetSpecial', 'internetspecial', 'customerPrice', 'customerprice', 'price', 'instoreprice', 'inStorePrice'])));
  const milesRaw = Number(first(v, ['mileage', 'miles']));
  const miles = Number.isFinite(milesRaw) ? `${Math.round(milesRaw).toLocaleString('en-US')} miles` : null;
  const facts = [
    ['price', 'Price', price],
    ['miles', 'Miles', miles],
    ['drivetrain', 'Drivetrain', first(v, ['drive', 'drivetrain', 'driveTrain'])],
    ['fuel', 'Fuel', first(v, ['fuel', 'fuelType', 'fueltype'])],
    ['color', 'Color', first(v, ['exteriorColor', 'exteriorcolor'])],
    ['engine', 'Engine', first(v, ['engine', 'engineDescription', 'enginedescription'])],
    ['transmission', 'Transmission', first(v, ['transmission'])],
    ['vin', 'VIN', first(v, ['vin', 'VIN'])],
    ['stock', 'Stock #', first(v, ['stockNumber', 'stocknumber', 'stock_number'])],
    ['link', 'Vehicle page', first(v, ['shortUrl', 'inventoryUrl', 'vdpLink', 'vehicleUrl'])],
  ].filter(([, , value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, label, value]) => ({ key, label, value: String(value).trim(),
      text: key === 'link' ? `${title ? `${title}: ` : ''}${String(value).trim()}` : `${label}: ${String(value).trim()}` }));
  return { title, photos, facts };
}
