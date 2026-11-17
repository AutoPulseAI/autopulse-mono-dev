// Who owns a vehicle, protected from the DMS feed (SOW G-085, 17 Nov 2026: "preserve customer/dealer-confirmed
// ownership; historical service/sale never automatically reopens no-longer-owned").
// A customer's own answer (the AI's ownership check: "no longer owns") or a staff member's mark is kept on the customer
// (Customer.ownership_overrides). The profile's Vehicles tab shows the customer as owner only when the DMS has a sale or
// service record for the VIN dated AFTER that mark (they bought it back, or it came in again under their name) - an
// older record arriving late never brings it back.
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';

const vinOf = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Record that a customer does / doesn't own a VIN. by: 'customer' (their own answer, via the AI) or 'staff'. */
export async function setOwnership({ customerId, dealerId, vin, owns, by = 'staff', byName = null, note = null, at = new Date() },
  { CustomerModel = Customer } = {}) {
  const v = vinOf(vin);
  if (!customerId || !mongoose.isValidObjectId(String(customerId)) || v.length < 11) return { saved: false, reason: 'no VIN' };
  await CustomerModel.updateOne({ _id: customerId, dealer_id: String(dealerId) }, { $pull: { ownership_overrides: { vin: v } } });
  const res = await CustomerModel.updateOne({ _id: customerId, dealer_id: String(dealerId) }, { $push: { ownership_overrides: {
    vin: v, owns: Boolean(owns), at, by, by_name: byName, note: note ? String(note).slice(0, 300) : null } } });
  return { saved: Boolean(res.modifiedCount), vin: v };
}

/**
 * The profile's view of one vehicle, with the customer's / staff mark applied.
 * @param {{ is_current_owner: boolean, owner_at?: Date|null }} derived  from the DMS records (latest record wins)
 * @param {{ owns: boolean, at: Date }|undefined} override
 */
export function applyOwnership(derived, override) {
  if (!override) return { ...derived, ownership_source: 'dms' };
  const dmsNewer = derived.owner_at && override.at && new Date(derived.owner_at) > new Date(override.at);
  if (dmsNewer) return { ...derived, ownership_source: 'dms', ownership_note: 'DMS record newer than the earlier mark' };
  return { ...derived, is_current_owner: Boolean(override.owns), ownership_source: override.by === 'customer' ? 'customer' : 'staff',
    ownership_note: override.owns ? 'Marked as owner' : `No longer owns (${override.by === 'customer' ? 'the customer said so' : `marked by ${override.by_name || 'staff'}`})` };
}

export const overridesByVin = (customers = []) => new Map(customers.flatMap((c) => c?.ownership_overrides || [])
  .sort((a, b) => new Date(a.at) - new Date(b.at)).map((o) => [o.vin, o]));
