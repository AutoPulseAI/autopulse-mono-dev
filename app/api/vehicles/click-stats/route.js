import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import VehicleClick from '@models/VehicleClick';
import Vehicle from '@models/Vehicle';
import User from '@models/User';
import moment from 'moment-timezone';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const dealerId = searchParams.get('dealer_id');
    const vehicleId = searchParams.get('vehicle_id');
    const vin = searchParams.get('vin');
    const shortCode = searchParams.get('short_code');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const groupBy = searchParams.get('group_by') || 'day'; // 'day', 'vehicle', 'dealer'
    
    // Build query
    const query = {};
    
    if (dealerId) {
      query.dealer_id = dealerId;
    }
    
    if (vehicleId) {
      query.vehicle_id = vehicleId;
    }
    
    if (vin) {
      query.vin = vin;
    }
    
    if (shortCode) {
      query.shortCode = shortCode;
    }
    
    // Date range filter
    if (startDate && endDate) {
      // Get dealer timezone if dealer_id is provided
      let dealerTimezone = 'America/New_York';
      if (dealerId) {
        const dealer = await User.findById(dealerId);
        dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';
      }
      
      const startDateStr = startDate.split('T')[0];
      const endDateStr = endDate.split('T')[0];
      const startMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
      // Use start of NEXT day (exclusive) to prevent including the next day
      const endMoment = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).add(1, 'day').startOf('day');
      
      query.clickedAt = {
        $gte: startMoment.utc().toDate(),
        $lt: endMoment.utc().toDate()  // Less than start of next day = excludes next day
      };
    }
    
    // Exclude bots by default (can add ?include_bots=true to include them)
    if (searchParams.get('include_bots') !== 'true') {
      query.isBot = false;
    }
    
    let stats;
    
    switch (groupBy) {
      case 'day':
        // Group by day
        stats = await VehicleClick.aggregate([
          { $match: query },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" }
              },
              count: { $sum: 1 },
              uniqueIPs: { $addToSet: "$ip" }
            }
          },
          {
            $project: {
              date: "$_id",
              count: 1,
              uniqueClicks: { $size: "$uniqueIPs" },
              _id: 0
            }
          },
          { $sort: { date: 1 } }
        ]);
        break;
        
      case 'vehicle':
        // Group by vehicle
        stats = await VehicleClick.aggregate([
          { $match: query },
          {
            $group: {
              _id: "$vehicle_id",
              count: { $sum: 1 },
              uniqueIPs: { $addToSet: "$ip" },
              vins: { $addToSet: "$vin" },
              shortCodes: { $addToSet: "$shortCode" }
            }
          },
          {
            $lookup: {
              from: 'vehicles',
              localField: '_id',
              foreignField: '_id',
              as: 'vehicle'
            }
          },
          {
            $unwind: {
              path: '$vehicle',
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $project: {
              vehicle_id: "$_id",
              vehicle_title: "$vehicle.title",
              vin: { $arrayElemAt: ["$vins", 0] },
              shortCode: { $arrayElemAt: ["$shortCodes", 0] },
              count: 1,
              uniqueClicks: { $size: "$uniqueIPs" },
              _id: 0
            }
          },
          { $sort: { count: -1 } }
        ]);
        break;
        
      case 'dealer':
        // Group by dealer
        stats = await VehicleClick.aggregate([
          { $match: query },
          {
            $group: {
              _id: "$dealer_id",
              count: { $sum: 1 },
              uniqueIPs: { $addToSet: "$ip" },
              uniqueVehicles: { $addToSet: "$vehicle_id" }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: '_id',
              foreignField: '_id',
              as: 'dealer'
            }
          },
          {
            $unwind: {
              path: '$dealer',
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $project: {
              dealer_id: "$_id",
              dealer_name: "$dealer.name",
              count: 1,
              uniqueClicks: { $size: "$uniqueIPs" },
              uniqueVehicles: { $size: "$uniqueVehicles" },
              _id: 0
            }
          },
          { $sort: { count: -1 } }
        ]);
        break;
        
      case 'source':
        // Group by source (email, sms, other)
        stats = await VehicleClick.aggregate([
          { $match: query },
          {
            $group: {
              _id: { $ifNull: ["$source", "other"] },
              count: { $sum: 1 },
              uniqueIPs: { $addToSet: "$ip" }
            }
          },
          {
            $project: {
              source: "$_id",
              count: 1,
              uniqueClicks: { $size: "$uniqueIPs" },
              _id: 0
            }
          },
          { $sort: { count: -1 } }
        ]);
        break;
        
      default:
        // Total summary
        const totalClicks = await VehicleClick.countDocuments(query);
        const uniqueIPs = await VehicleClick.distinct('ip', query);
        const uniqueVehicles = await VehicleClick.distinct('vehicle_id', query);
        
        stats = {
          totalClicks: totalClicks,
          uniqueClicks: uniqueIPs.length,
          uniqueVehicles: uniqueVehicles.length,
          clicksBySource: await VehicleClick.aggregate([
            { $match: query },
            {
              $group: {
                _id: { $ifNull: ["$source", "other"] },
                count: { $sum: 1 }
              }
            },
            {
              $project: {
                source: "$_id",
                count: 1,
                _id: 0
              }
            }
          ])
        };
        break;
    }
    
    return NextResponse.json({
      success: true,
      groupBy: groupBy,
      stats: stats,
      filters: {
        dealer_id: dealerId || null,
        vehicle_id: vehicleId || null,
        vin: vin || null,
        short_code: shortCode || null,
        start_date: startDate || null,
        end_date: endDate || null
      }
    });
    
  } catch (error) {
    console.error('Error fetching vehicle click stats:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch click statistics',
        message: error.message 
      },
      { status: 500 }
    );
  }
}

