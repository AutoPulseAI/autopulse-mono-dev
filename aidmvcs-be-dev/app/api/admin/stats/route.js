// app/api/admin/stats/route.js
import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import User from '@models/User';
import Subscription from '@models/Subscription';
import dbConnect from '@lib/mongodb';
import { requireSuperAdmin } from "@lib/apiGuard";
import { dashboardCacheKey, getCached, setCached } from '@lib/dashboardCache';

// DB-SCALING #2 / B2: one aggregation, many counts. Each facet applies its own filter to the shared
// (already-$matched) set, returning the same number its old countDocuments returned. The leading
// $match is AND-equivalent to spreading baseConditions into every count. Zero matches => [] => 0.
// NOTE: aggregate() does not auto-cast like countDocuments(), so ObjectId values must be cast by the caller.
async function countFacet(Model, matchStage, facets) {
  const [result = {}] = await Model.aggregate([
    { $match: matchStage },
    {
      $facet: Object.fromEntries(
        Object.entries(facets).map(([key, cond]) => [key, [{ $match: cond }, { $count: 'count' }]]),
      ),
    },
  ]);
  const counts = {};
  for (const key of Object.keys(facets)) counts[key] = result[key]?.[0]?.count || 0;
  return counts;
}

export async function GET(request) {
  // Security fix (Nov 2026): super admin only (it had no sign-in check).
  const guard = await requireSuperAdmin(request);
  if (guard.response) return guard.response;
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendor_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const currentDate = new Date();

    // Dashboard stats cache (DB-SCALING #4): ~16 sequential count ops; output depends only on
    // vendor_id + date range. Short-TTL cache; fail-safe (Redis down => compute). DASHBOARD_CACHE=off to disable.
    const statsCacheKey = dashboardCacheKey('admin:stats', {
      vendor_id: vendorId || null, start_date: startDate || null, end_date: endDate || null,
    });
    const cached = await getCached(statsCacheKey);
    if (cached) return NextResponse.json(cached);

    // Base query conditions
    const baseConditions = {};
    if (startDate && endDate) {
      baseConditions.createdAt = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }

    // Main query function.
    // DB-SCALING #2 / B2: the per-key countDocuments calls are collapsed into ONE $facet per collection
    // (plus the independent revenue aggregate, run in parallel). Every facet filter below is identical to
    // the countDocuments filter it replaces, so the returned numbers are unchanged. baseConditions is applied
    // once as the facet's leading $match instead of spread into each count (AND-equivalent).
    const getCounts = async () => {
      if (vendorId) {
        // Vendor-specific statistics. aggregate() won't cast the vendorId string to the ObjectId that
        // vendor_id/parent_id are (countDocuments did), so cast it here to keep the match set identical.
        const vid = new mongoose.Types.ObjectId(vendorId);
        const dealerOr = [
          { vendor_id: vid, type: 'dealer' },
          { parent_id: vid, type: 'dealer' },
        ];
        const [vendor, counts, revenue] = await Promise.all([
          User.findOne({ _id: vendorId }).lean(),
          countFacet(User, baseConditions, {
            total_dealers: { $or: dealerOr },
            total_staff: { parent_id: vid, type: { $ne: 'dealer' } },
            subscribed_dealers: { $or: dealerOr, package_expiry: { $gte: currentDate } },
            subscribed_staff: { parent_id: vid, type: { $ne: 'dealer' }, package_expiry: { $gte: currentDate } },
          }),
          Subscription.aggregate([
            { $match: { user: vendorId, ...baseConditions } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
        ]);
        return { vendor, ...counts, revenue };
      } else {
        // Global admin statistics. All filters are literals/dates => no casting needed.
        const [counts, revenue] = await Promise.all([
          countFacet(User, baseConditions, {
            // Independent entities
            independent_vendors: { type: 'vendor', parent_id: null, vendor_id: null },
            independent_dealers: { type: 'dealer', parent_id: null, vendor_id: null },
            // All dealers without parent_id (independent only, excluding staff/members)
            all_independent_dealers: { type: 'dealer', $or: [{ parent_id: null }, { parent_id: { $exists: false } }] },
            // Vendor-associated entities
            vendor_dealers: { type: 'dealer', vendor_id: { $ne: null } },
            staff_members: { type: 'admin' },
            // Subscription status
            subscribed_vendors: { type: 'vendor', parent_id: null, vendor_id: null, package_expiry: { $gte: currentDate } },
            subscribed_dealers: { type: 'dealer', package_expiry: { $gte: currentDate } },
            // Expired/none subscriptions (all vendors and dealers)
            expired_subscriptions: { type: { $in: ['vendor', 'dealer'] }, package_expiry: { $lt: currentDate } },
            no_subscription: { type: { $in: ['vendor', 'dealer'] }, $or: [{ package_expiry: null }, { package_expiry: { $exists: false } }] },
            // Dealer-only subscription status (excluding staff with parent_id)
            dealer_subscribed: { type: 'dealer', $or: [{ parent_id: null }, { parent_id: { $exists: false } }], package_expiry: { $gte: currentDate } },
            dealer_expired: { type: 'dealer', $or: [{ parent_id: null }, { parent_id: { $exists: false } }], package_expiry: { $lt: currentDate } },
            dealer_no_subscription: {
              type: 'dealer',
              $or: [{ parent_id: null }, { parent_id: { $exists: false } }],
              $and: [{ $or: [{ package_expiry: null }, { package_expiry: { $exists: false } }] }],
            },
          }),
          Subscription.aggregate([
            { $match: baseConditions },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
        ]);
        return { ...counts, revenue };
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

    await setCached(statsCacheKey, response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin statistics' },
      { status: 500 }
    );
  }
}