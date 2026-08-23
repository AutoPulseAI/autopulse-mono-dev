// app/api/vehicles/route.js
import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';
import User from '@models/User';
import { NextResponse } from 'next/server';

export async function GET(request) {
  await dbConnect();
  const { searchParams } = new URL(request.url);
  const dealerId = searchParams.get('dealer_id');
  const page = parseInt(searchParams.get('page')) || 1;
  const limit = parseInt(searchParams.get('limit')) || 10;
  const vin = searchParams.get('vin') || '';
  const make = searchParams.get('make') || '';
  const model = searchParams.get('model') || '';
  const year = searchParams.get('year') || '';
  const stock = searchParams.get('stock') || '';
  const search = searchParams.get('search') || ''; // Generic search parameter

  const filter = {};
  if (dealerId) filter.dealerId = dealerId;
  
  // If generic search is provided, search across multiple fields
  if (search) {
    filter.$or = [
      { make: { $regex: search, $options: 'i' } },
      { model: { $regex: search, $options: 'i' } },
      { vin: { $regex: search, $options: 'i' } },
      { stocknumber: { $regex: search, $options: 'i' } },
      { year: { $regex: search, $options: 'i' } }
    ];
  } else {
    // Use specific filters if no generic search
    if (vin) filter.vin = { $regex: vin, $options: 'i' };
    if (make) filter.make = { $regex: make, $options: 'i' };
    if (model) filter.model = { $regex: model, $options: 'i' };
    if (stock) filter.stocknumber = { $regex: stock, $options: 'i' };
    if (year) filter.year = year;
  }

  // Get distinct dealers for dropdown
  const dealers = await Vehicle.distinct('dealerId');
  const dealerDetails = await User.find({ _id: { $in: dealers } }, 'name');

  const totalItems = await Vehicle.countDocuments(filter);
  const vehicles = await Vehicle.find(filter)
    .skip((page - 1) * limit)
    .limit(limit)
    .sort({ createdAt: -1 })
    .populate({
      path: 'dealerId',
      select: 'name',
      model: 'User' // Explicitly specify the model
    }) .lean();
    const transformedVehicles = vehicles.map(vehicle => ({
    ...vehicle,
    dealerName: vehicle.dealerId?.name || 'N/A'
  }));

  const totalPages = Math.ceil(totalItems / limit);
  return NextResponse.json({
    data: transformedVehicles,
    dealers: dealerDetails,
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