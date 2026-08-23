import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code') || 'GTZNO7M8';
    
    await dbConnect();
    
    // Find the specific vehicle
    const vehicle = await Vehicle.findOne({ shortCode: code });
    
    // Get all vehicles with shortCode field
    const allVehiclesWithShortCode = await Vehicle.find({ 
      shortCode: { $exists: true } 
    }).select('shortCode title inventoryUrl vin').limit(20);
    
    // Get count
    const totalVehicles = await Vehicle.countDocuments();
    const vehiclesWithShortCode = await Vehicle.countDocuments({ 
      shortCode: { $exists: true } 
    });
    
    return NextResponse.json({
      searchedCode: code,
      found: !!vehicle,
      vehicle: vehicle ? {
        _id: vehicle._id,
        shortCode: vehicle.shortCode,
        title: vehicle.title,
        inventoryUrl: vehicle.inventoryUrl,
        imageUrl: vehicle.imageUrl,
        description: vehicle.description,
        vin: vehicle.vin,
        dealerId: vehicle.dealerId,
        hasInventoryUrl: !!vehicle.inventoryUrl,
        allFields: Object.keys(vehicle.toObject())
      } : null,
      stats: {
        totalVehicles,
        vehiclesWithShortCode
      },
      sampleVehicles: allVehiclesWithShortCode.map(v => ({
        shortCode: v.shortCode,
        title: v.title,
        hasInventoryUrl: !!v.inventoryUrl,
        inventoryUrl: v.inventoryUrl,
        vin: v.vin
      }))
    });
  } catch (error) {
    console.error('Error checking vehicle:', error);
    return NextResponse.json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

