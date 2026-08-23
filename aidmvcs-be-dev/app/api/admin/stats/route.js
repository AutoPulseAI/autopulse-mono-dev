// app/api/admin/stats/route.js
import { NextResponse } from 'next/server';
import User from '@models/User';
import Subscription from '@models/Subscription';
import dbConnect from '@lib/mongodb';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendor_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const currentDate = new Date();

    // Base query conditions
    const baseConditions = {};
    if (startDate && endDate) {
      baseConditions.createdAt = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }

    // Main query function
    const getCounts = async () => {
      if (vendorId) {
        // Vendor-specific statistics
        return {
          // Vendor info
          vendor: await User.findOne({ _id: vendorId }).lean(),
          
          // User counts
          total_dealers: await User.countDocuments({
            $or: [
              { vendor_id: vendorId, type: 'dealer' },
              { parent_id: vendorId, type: 'dealer' }
            ],
            ...baseConditions
          }),
          total_staff: await User.countDocuments({
            parent_id: vendorId,
            type: { $ne: 'dealer' },
            ...baseConditions
          }),
          
          // Subscription counts
          subscribed_dealers: await User.countDocuments({
            $or: [
              { vendor_id: vendorId, type: 'dealer' },
              { parent_id: vendorId, type: 'dealer' }
            ],
            package_expiry: { $gte: currentDate },
            ...baseConditions
          }),
          subscribed_staff: await User.countDocuments({
            parent_id: vendorId,
            type: { $ne: 'dealer' },
            package_expiry: { $gte: currentDate },
            ...baseConditions
          }),
          
          // Revenue
          revenue: await Subscription.aggregate([
            { 
              $match: { 
                user: vendorId,
                ...baseConditions 
              } 
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
          ])
        };
      } else {
        // Global admin statistics
        return {
          // Independent entities
          independent_vendors: await User.countDocuments({
            type: 'vendor',
            parent_id: null,
            vendor_id: null,
            ...baseConditions
          }),
          
          independent_dealers: await User.countDocuments({
            type: 'dealer',
            parent_id: null,
            vendor_id: null,
            ...baseConditions
          }),
          
          // All dealers without parent_id (independent only, excluding staff/members)
          all_independent_dealers: await User.countDocuments({
            type: 'dealer',
            $or: [
              { parent_id: null },
              { parent_id: { $exists: false } }
            ],
            ...baseConditions
          }),
          
          // Vendor-associated entities
          vendor_dealers: await User.countDocuments({
            type: 'dealer',
            vendor_id: { $ne: null },
            ...baseConditions
          }),
          
          staff_members: await User.countDocuments({
            type: 'admin',
            ...baseConditions
          }),
          
          // Subscription status
          subscribed_vendors: await User.countDocuments({
            type: 'vendor',
            parent_id: null,
            vendor_id: null,
            package_expiry: { $gte: currentDate },
            ...baseConditions
          }),
          
          subscribed_dealers: await User.countDocuments({
            type: 'dealer',
            package_expiry: { $gte: currentDate },
            ...baseConditions
          }),
          
          // Revenue
          revenue: await Subscription.aggregate([
            { $match: baseConditions },
            { $group: { _id: null, total: { $sum: '$amount' } } }
          ]),
          
          // Expired/none subscriptions (all vendors and dealers)
          expired_subscriptions: await User.countDocuments({
            type: { $in: ['vendor', 'dealer'] },
            package_expiry: { $lt: currentDate },
            ...baseConditions
          }),
          
          no_subscription: await User.countDocuments({
            type: { $in: ['vendor', 'dealer'] },
            $or: [
              { package_expiry: null },
              { package_expiry: { $exists: false } }
            ],
            ...baseConditions
          }),
          
          // Dealer-only subscription status (excluding staff with parent_id)
          dealer_subscribed: await User.countDocuments({
            type: 'dealer',
            $or: [
              { parent_id: null },
              { parent_id: { $exists: false } }
            ],
            package_expiry: { $gte: currentDate },
            ...baseConditions
          }),
          
          dealer_expired: await User.countDocuments({
            type: 'dealer',
            $or: [
              { parent_id: null },
              { parent_id: { $exists: false } }
            ],
            package_expiry: { $lt: currentDate },
            ...baseConditions
          }),
          
          dealer_no_subscription: await User.countDocuments({
            type: 'dealer',
            $or: [
              { parent_id: null },
              { parent_id: { $exists: false } }
            ],
            $and: [
              {
                $or: [
                  { package_expiry: null },
                  { package_expiry: { $exists: false } }
                ]
              }
            ],
            ...baseConditions
          })
        };
      }
    };

    const stats = await getCounts();

    // Format response
    const response = vendorId ? {
      // Vendor-specific response
      vendor: stats.vendor,
      counts: {
        dealers: stats.total_dealers,
        staff: stats.total_staff,
        subscribed_dealers: stats.subscribed_dealers,
        subscribed_staff: stats.subscribed_staff
      },
      revenue: stats.revenue[0]?.total || 0
    } : {
      // Global admin response
      counts: {
        independent_vendors: stats.independent_vendors,
        independent_dealers: stats.independent_dealers,
        all_independent_dealers: stats.all_independent_dealers,
        vendor_dealers: stats.vendor_dealers,
        staff_members: stats.staff_members,
        subscribed_vendors: stats.subscribed_vendors,
        subscribed_dealers: stats.subscribed_dealers
      },
      revenue: stats.revenue[0]?.total || 0,
      subscription_status: {
        active: stats.subscribed_vendors + stats.subscribed_dealers,
        expired: stats.expired_subscriptions,
        none: stats.no_subscription
      },
      dealer_subscription_status: {
        active: stats.dealer_subscribed,
        expired: stats.dealer_expired,
        none: stats.dealer_no_subscription
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin statistics' },
      { status: 500 }
    );
  }
}