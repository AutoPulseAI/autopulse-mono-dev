import Lead from "@models/Lead";
import User from "@models/User";
import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";


export async function GET(request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const vendor_id = searchParams.get('vendor_id');
    const dealer_id = searchParams.get('dealer_id');
    const start_date = searchParams.get('start_date');
    const end_date = searchParams.get('end_date');

    if (!vendor_id) {
      return NextResponse.json(
        { message: "Vendor ID is required" },
        { status: 400 }
      );
    }

    // Get all dealer IDs for this vendor if no specific dealer is selected
    let dealerIds = [];
    if (dealer_id) {
      dealerIds = [dealer_id];
    } else {
      const dealers = await User.find(
        { vendor_id, type: "dealer" },
        { _id: 1 }
      ).lean();
      dealerIds = dealers.map((d) => d._id);
    }

    // Date filter
    const dateFilter = {};
    if (start_date && end_date) {
      dateFilter.createdAt = {
        $gte: new Date(start_date),
        $lte: new Date(end_date),
      };
    }

    // Base match query
    const matchQuery = {
      dealer_id: { $in: dealerIds },
      ...dateFilter,
    };

    // Get total leads count
    const totalLeads = await Lead.countDocuments(matchQuery);

    // Get new this week count
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const newThisWeek = await Lead.countDocuments({
      ...matchQuery,
      createdAt: { $gte: oneWeekAgo },
    });

    // Get converted leads count
    const converted = await Lead.countDocuments({
      ...matchQuery,
      "data.status": "converted",
    });

    // Get visit requested count
    const visitRequested = await Lead.countDocuments({
      ...matchQuery,
      "data.status": "visit_requested",
    });

    // Group by source
    const sources = await Lead.aggregate([
      { $match: matchQuery },
      { $group: { _id: "$source", count: { $sum: 1 } } },
    ]);

    // Group by status
    const statuses = await Lead.aggregate([
      { $match: matchQuery },
      { $group: { _id: "$data.status", count: { $sum: 1 } } },
    ]);

    // Group by date for activity over time
    const activityOverTime = await Lead.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get dealer performance stats
    const dealerPerformance = await Lead.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          localField: "dealer_id",
          foreignField: "_id",
          as: "dealer",
        },
      },
      { $unwind: "$dealer" },
      {
        $group: {
          _id: "$dealer_id",
          dealer_name: { $first: "$dealer.name" },
          lead_count: { $sum: 1 },
          converted_count: {
            $sum: {
              $cond: [{ $eq: ["$data.status", "converted"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return NextResponse.json({
      total_leads: totalLeads,
      new_this_week: newThisWeek,
      converted,
      visit_requested: visitRequested,
      total_dealers: dealerIds.length,
      active_dealers: dealerPerformance.length,
      sources,
      statuses,
      activity_over_time: activityOverTime,
      dealer_performance: dealerPerformance,
    });
  } catch (error) {
    console.error("Error fetching vendor lead stats:", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}