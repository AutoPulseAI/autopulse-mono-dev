import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import CampaignLead from "@models/CampaignLead";
import Campaign from "@models/Campaign";

// GET: Fetch all leads for a specific campaign
export async function GET(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;
    const url = new URL(req.url);
    
    const page = parseInt(url.searchParams.get("page")) || 1;
    const limit = parseInt(url.searchParams.get("limit")) || 100; // Default to 100 for large datasets

    // Verify campaign exists
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    const campaignIdStr = id.toString();
    const totalLeads = await CampaignLead.countDocuments({ campaign_id: campaignIdStr });
    const leads = await CampaignLead.find({ campaign_id: campaignIdStr })
      .populate({ path: 'lead_id', select: 'name email phone', strictPopulate: false })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return NextResponse.json({
      data: leads,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalLeads / limit),
        totalItems: totalLeads,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(totalLeads / limit),
        hasPreviousPage: page > 1
      }
    }, { status: 200 });
  } catch (error) {
    console.error("Error fetching campaign leads:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch campaign leads" },
      { status: 500 }
    );
  }
}

