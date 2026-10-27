// Betsy, 27 Oct 2026 meeting (the CarGurus Tesla Model 3 lead): "the vehicle didn't go into the customer profile". The
// vehicle each lead is about, newest lead first, once per car.
export function interestedVehicles(leads) {
  const seen = new Set();
  const out = [];
  for (const lead of [...(leads || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))) {
    const vehicle = { vin: lead.vin || null, year: lead.vehicle_year || null, make: lead.vehicle_make || null,
      model: lead.vehicle_model || null };
    const key = vehicle.vin || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...vehicle, source: lead.lead_source || lead.source || null, at: lead.createdAt || null,
      lead_id: String(lead._id || lead.id || "") });
  }
  return out;
}
