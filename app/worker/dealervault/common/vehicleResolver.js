import Vehicle from '../../../models/Vehicle.js';

export function normalizeVin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const vin = value.trim().toUpperCase();
  // Permit historical VIN lengths; reject placeholders and non-alphanumeric IDs.
  return /^[A-Z0-9]+$/.test(vin) && !['NA', 'NONE', 'NULL', 'UNKNOWN', 'UNDEFINED'].includes(vin)
    ? vin : null;
}

export async function resolveVehicles(entries, context, Model = Vehicle) {
  const vins = [...new Set(entries.map(entry => entry.document.vin).filter(Boolean))];
  const vehicles = vins.length ? await Model.find({ dealerId: context.dealer_id, vin: { $in: vins } })
    .select('_id vin').lean() : [];
  const byVin = new Map();
  for (const vehicle of vehicles) {
    const matches = byVin.get(vehicle.vin) || [];
    matches.push(vehicle);
    byVin.set(vehicle.vin, matches);
  }
  for (const entry of entries) {
    const matches = byVin.get(entry.document.vin) || [];
    entry.document.vehicle_id = matches.length === 1 ? matches[0]._id : null;
    if (matches.length !== 1) {
      entry.warnings.push(!entry.document.vin
        ? (entry.document.VIN?.trim() ? 'VIN_INVALID' : 'VIN_MISSING')
        : matches.length ? 'VEHICLE_AMBIGUOUS' : 'VEHICLE_NOT_FOUND');
    }
  }
}
