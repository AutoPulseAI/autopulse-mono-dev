import Booking from "@models/Booking";

// Who made each lead's appointment (Betsy, 21 Oct 2026: every appointment tagged AI or staff): the latest booking's
// created_by. 'customer' (the public booking page, reached from the AI's link) counts as AI - nobody on staff made
// it. A lead with no booking record (set by hand before bookings were recorded) counts as staff.
export async function bookedByForLeads(leadIds) {
  const ids = leadIds.map(String);
  const byLead = new Map(ids.map((id) => [id, 'staff']));
  if (!ids.length) return byLead;
  const latest = await Booking.aggregate([
    { $match: { lead_id: { $in: ids } } },
    { $sort: { _id: -1 } },
    { $group: { _id: '$lead_id', created_by: { $first: '$created_by' } } },
  ]);
  for (const b of latest) {
    if (b.created_by === 'ai' || b.created_by === 'customer') byLead.set(String(b._id), 'ai');
  }
  return byLead;
}

export async function bookingCreatorSplit(leadIds) {
  const byLead = await bookedByForLeads(leadIds);
  const byAi = [...byLead.values()].filter((v) => v === 'ai').length;
  return { by_ai: byAi, by_staff: byLead.size - byAi };
}
