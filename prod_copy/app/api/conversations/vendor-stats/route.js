import Email from "@models/Email";
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
    const limit = searchParams.get('limit') || 50;

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
      dateFilter.timestamp = {
        $gte: new Date(start_date),
        $lte: new Date(end_date),
      };
    }

    // Base match query
    const matchQuery = {
      dealer_id: { $in: dealerIds },
      ...dateFilter,
    };

    // Get recent communications
    const communications = await Email.find(matchQuery)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    // Group by communication type (email, sms, etc.)
    const communicationTypes = await Email.aggregate([
      { $match: matchQuery },
      { $group: { _id: "$source", count: { $sum: 1 } } },
    ]);

    return NextResponse.json({
      communications,
      communication_types: communicationTypes,
    });
  } catch (error) {
    console.error("Error fetching vendor communication stats:", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}