// GET /api/inventory/lookup?dealer_id&q - cars in the dealer's inventory by stock # or VIN (app/lib/inventoryLookup.js),
// for the lead card's VIN box. Signed-in staff of that dealership only.
import dbConnect from '@lib/mongodb';
import { requireDealerAccess } from '@lib/apiGuard';
import { lookupInventory } from '@lib/inventoryLookup';

export const runtime = 'nodejs';

export async function GET(req) {
  await dbConnect();
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id') || '';
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  return Response.json({ cars: await lookupInventory(dealerId, params.get('q')) }, { headers: { 'Cache-Control': 'no-store' } });
}
