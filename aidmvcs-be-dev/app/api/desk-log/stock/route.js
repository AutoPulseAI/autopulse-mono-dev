// Stock # lookup at the Desk Log check-in (13 Nov 2026 meeting, 26:45 / 44:40: typing a stock number like 2788C pulls
// up the car from the dealer's inventory). ?dealer_id &q (stock # or VIN, 2+ characters) -> up to 8 cars in stock
// (app/lib/inventoryLookup.js).
import { deskLogAccess, json } from '@lib/deskLog/access';
import { lookupInventory } from '@lib/inventoryLookup';

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id');
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  return json({ cars: await lookupInventory(dealerId, params.get('q')) });
}
