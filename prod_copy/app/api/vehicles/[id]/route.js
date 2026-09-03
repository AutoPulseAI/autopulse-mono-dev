// app/api/vehicles/[id]/route.js
import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  await dbConnect();
  const { id } = params;
  const vehicle = await Vehicle.findById(id).lean();
  if (!vehicle) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(vehicle);
}