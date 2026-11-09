// app/api/vehicles/route.js
import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';
import { NextResponse } from 'next/server';
import { requireSuperAdmin } from "@lib/apiGuard";

export async function GET(request) {
  // Security fix (Nov 2026): super admin only (it had no sign-in check).
  const guard = await requireSuperAdmin(request);
  if (guard.response) return guard.response;
  await dbConnect();
  const { searchParams } = new URL(request.url);
 
  const page = parseInt(searchParams.get('page')) || 1;
  const limit = parseInt(searchParams.get('limit')) || 10;
  const vin = searchParams.get('vin') || '';
  const make = searchParams.get('make') || '';
  const model = searchParams.get('model') || '';

 

  const filter = {  };
  if (vin) filter.vin = { $regex: vin, $options: 'i' };
  if (make) filter.make = { $regex: make, $options: 'i' };
  if (model) filter.model = { $regex: model, $options: 'i' };

  const totalItems = await Vehicle.countDocuments(filter);
  const vehicles = await Vehicle.find(filter)
    .skip((page - 1) * limit)
    .limit(limit)
    .sort({ createdAt: -1 })
    .lean();

  const totalPages = Math.ceil(totalItems / limit);
  return NextResponse.json({
    data: vehicles,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems,
      itemsPerPage: limit,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  });
}