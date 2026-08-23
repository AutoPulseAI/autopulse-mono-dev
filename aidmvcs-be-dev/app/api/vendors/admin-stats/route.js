// app/api/leads/admin-stats/route.js
import { NextResponse } from 'next/server';
import Lead from '@models/Lead';
import User from '@models/User';
import dbConnect from '@lib/mongodb';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendor_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // Build query conditions
    const leadQuery = {};
    const userQuery =  { parent_id: { $eq: null },'type':{$ne:'admin'} };
    
    if (vendorId) {
      userQuery.vendor_id = vendorId;
      // Assuming leads have dealer_id which references User
      const dealerIds = await User.find(userQuery).distinct('_id');
      leadQuery.dealer_id = { $in: dealerIds };
    }

    if (startDate && endDate) {
      leadQuery.createdAt = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }

    // Get total leads and converted leads
    const [totalLeads, convertedLeads] = await Promise.all([
      Lead.countDocuments(leadQuery),
      Lead.countDocuments({ ...leadQuery, status: 'converted' })
    ]);

    // Get lead sources breakdown
    const sources = await Lead.aggregate([
      { $match: leadQuery },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);

    // Get lead status breakdown
    const statuses = await Lead.aggregate([
      { $match: leadQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get vendor performance (leads per vendor)
    const vendorPerformance = await User.aggregate([
        // Start with all vendors
        { $match: { type: 'vendor', parent_id: { $eq: null }  } },
        
        // Lookup all dealers that belong to this vendor
        {
          $lookup: {
            from: 'users',
            let: { vendorId: '$_id' },
            pipeline: [
              { 
                $match: { 
                  $expr: { 
                    $and: [
                      { $eq: ['$type', 'dealer'] },
                      { $eq: ['$vendor_id', '$$vendorId'] }
                    ]
                  }
                } 
              }
            ],
            as: 'dealers'
          }
        },
        
        // Lookup leads that are either:
        // 1. Directly assigned to this vendor (if you have vendor_id in leads)
        // 2. Assigned to any of this vendor's dealers
        {
          $lookup: {
            from: 'leads',
            let: { vendorId: '$_id', dealerIds: '$dealers._id' },
            pipeline: [
              { 
                $match: { 
                  $expr: {
                    $or: [
                      // If leads have direct vendor reference
                      { $eq: ['$vendor_id', '$$vendorId'] },
                      // Or assigned to any of this vendor's dealers
                      { $in: ['$dealer_id', '$$dealerIds'] }
                    ]
                  }
                }
              }
            ],
            as: 'leads'
          }
        },
        
        // Project the final results
        {
          $project: {
            vendor_id: '$_id',
            vendor_name: '$name',
            lead_count: { $size: '$leads' },
            dealer_count: { $size: '$dealers' },
            // Optional: include package details if needed
            package_expiry: 1,
            package_dealers_allowed: 1,
            package_dealers_used: { $size: '$dealers' }
          }
        }
      ]);

    // Get activity over time (monthly)
    const activityOverTime = await Lead.aggregate([
      { $match: leadQuery },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return NextResponse.json({
      total_leads: totalLeads,
      converted_leads: convertedLeads,
      sources,
      statuses,
      vendor_performance: vendorPerformance,
      activity_over_time: activityOverTime
    });
  } catch (error) {
    console.error('Error fetching lead stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lead statistics' },
      { status: 500 }
    );
  }
}