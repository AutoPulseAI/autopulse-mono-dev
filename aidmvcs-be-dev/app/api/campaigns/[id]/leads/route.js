import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import CampaignLead from "@models/CampaignLead";
import Campaign from "@models/Campaign";
import { requireDealerAccess } from "@lib/apiGuard";
import mongoose from "mongoose";
import Lead from "@models/Lead";
import { logActivity } from "@lib/activityLog";
import { cannotAdd } from "@lib/campaignMembers";

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
    // Security fix (Nov 2026): the campaign's own dealer, its agency or a super admin (it listed any campaign's leads).
    const guard = await requireDealerAccess(req, String(campaign.dealer_id));
    if (guard.response) return guard.response;

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


// POST { lead_id }: add one lead's customer to this campaign (19 Nov 2026, the lead's "..." menu - "Add Customer to
// Campaign"). Same dealership only, once per campaign, only before the campaign starts sending (lib/campaignMembers).
export async function POST(req, { params }) {
  await dbConnect();
  const { id } = await params;
  const campaign = mongoose.isValidObjectId(id) ? await Campaign.findById(id) : null;
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const guard = await requireDealerAccess(req, String(campaign.dealer_id));
  if (guard.response) return guard.response;
  const body = await req.json().catch(() => ({}));
  const lead = mongoose.isValidObjectId(body?.lead_id) ? await Lead.findById(body.lead_id)
    .select("dealer_id customer_id name email phone").lean() : null;
  if (!lead || String(lead.dealer_id) !== String(campaign.dealer_id)) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const why = cannotAdd(campaign, lead);
  if (why) return NextResponse.json({ error: why }, { status: 409 });
  const campaignId = String(campaign._id);
  if (await CampaignLead.exists({ campaign_id: campaignId, lead_id: lead._id })) {
    return NextResponse.json({ added: false, message: "Already in this campaign" });
  }
  await CampaignLead.create({ campaign_id: campaignId, name: lead.name || lead.email || lead.phone, dealer_id: String(campaign.dealer_id),
    email: lead.email || "", phone: lead.phone || "", lead_id: lead._id, status: "pending" });
  await Campaign.updateOne({ _id: campaign._id }, { $inc: { "stats.total_leads": 1 } });
  await logActivity({ dealer_id: campaign.dealer_id, lead_id: lead._id, customer_id: lead.customer_id || null,
    actor_type: "staff", actor_id: guard.user?._id || null, actor_name: guard.user?.name || null,
    action: "campaign_added", to: campaign.name });
  return NextResponse.json({ added: true, message: `Added to ${campaign.name}` });
}
