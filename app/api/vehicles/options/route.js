import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';
import Lead from '@models/Lead';
import { NextResponse } from 'next/server';

function dedupeCaseInsensitive(values) {
  const map = new Map();
  values.forEach((item) => {
    if (item == null) return;
    const value = String(item).trim();
    if (!value) return;
    // Skip invalid/import junk values (e.g. XML CDATA leftovers)
    if (
      value.includes('CDATA') ||
      value.includes('<![') ||
      value.includes(']]>') ||
      /^[\[\]<!>-]+$/.test(value)
    ) {
      return;
    }
    const key = value.toLowerCase();
    if (!map.has(key) || value !== value.toLowerCase()) {
      map.set(key, value);
    }
  });
  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
  );
}

export async function GET(request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const dealerId = searchParams.get('dealer_id');

    if (!dealerId) {
      return NextResponse.json({ error: 'Dealer ID is required' }, { status: 400 });
    }

    const dealerVehicleFilter = { dealerId };
    const nonEmpty = (field) => ({
      ...dealerVehicleFilter,
      [field]: { $exists: true, $nin: [null, ''] }
    });

    const [
      vehicleMakes,
      leadMakes,
      vehicleModels,
      leadModels,
      vehicleYears,
      leadYears,
      stocknumbers,
      conditions
    ] = await Promise.all([
      Vehicle.distinct('make', nonEmpty('make')),
      Lead.distinct('vehicle_make', {
        dealer_id: dealerId,
        vehicle_make: { $exists: true, $nin: [null, ''] }
      }),
      Vehicle.distinct('model', nonEmpty('model')),
      Lead.distinct('vehicle_model', {
        dealer_id: dealerId,
        vehicle_model: { $exists: true, $nin: [null, ''] }
      }),
      Vehicle.distinct('year', nonEmpty('year')),
      Lead.distinct('vehicle_year', {
        dealer_id: dealerId,
        vehicle_year: { $exists: true, $nin: [null, ''] }
      }),
      Vehicle.distinct('stocknumber', nonEmpty('stocknumber')),
      Vehicle.distinct('condition', nonEmpty('condition'))
    ]);

    return NextResponse.json({
      makes: dedupeCaseInsensitive([...vehicleMakes, ...leadMakes]),
      models: dedupeCaseInsensitive([...vehicleModels, ...leadModels]),
      years: dedupeCaseInsensitive([...vehicleYears, ...leadYears]),
      stocknumbers: dedupeCaseInsensitive(stocknumbers),
      conditions: dedupeCaseInsensitive(
        conditions.length > 0 ? conditions : ['New', 'Used', 'Certified']
      )
    });
  } catch (error) {
    console.error('Error fetching vehicle filter options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vehicle filter options' },
      { status: 500 }
    );
  }
}
