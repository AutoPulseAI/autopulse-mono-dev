import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Campaign from "@models/Campaign";

/**
 * POST endpoint to fix campaigns that are incorrectly marked as "active"
 * when their scheduled date is still in the future
 */
export async function POST(req) {
  try {
    await dbConnect();

    const now = new Date();
    
    // Find campaigns that are "active" but scheduled date is in the future
    const incorrectCampaigns = await Campaign.find({
      status: 'active',
      actual_scheduled_date: { $gt: now }, // Scheduled date is in the future
      'stats.sent': 0 // No messages sent yet
    });

    if (incorrectCampaigns.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No campaigns need fixing',
        fixed: 0
      });
    }

    console.log(`🔧 Found ${incorrectCampaigns.length} campaign(s) incorrectly marked as active`);

    const fixed = [];
    for (const campaign of incorrectCampaigns) {
      console.log(`  - Fixing ${campaign.name} (${campaign._id}): scheduled for ${campaign.actual_scheduled_date}, but marked as active`);
      
      await Campaign.findByIdAndUpdate(campaign._id, {
        status: 'scheduled'
      });

      fixed.push({
        id: campaign._id.toString(),
        name: campaign.name,
        scheduledFor: campaign.actual_scheduled_date,
        previousStatus: 'active',
        newStatus: 'scheduled'
      });
    }

    console.log(`✅ Fixed ${fixed.length} campaign(s)`);

    return NextResponse.json({
      success: true,
      message: `Fixed ${fixed.length} campaign(s)`,
      fixed: fixed
    });
  } catch (error) {
    console.error("Error fixing campaign statuses:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fix campaign statuses" },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check for campaigns that need fixing
 */
export async function GET(req) {
  try {
    await dbConnect();

    const now = new Date();
    
    // Find campaigns that are "active" but scheduled date is in the future
    const incorrectCampaigns = await Campaign.find({
      status: 'active',
      actual_scheduled_date: { $gt: now }, // Scheduled date is in the future
      'stats.sent': 0 // No messages sent yet
    }).select('_id name actual_scheduled_date status stats').lean();

    return NextResponse.json({
      success: true,
      needsFixing: incorrectCampaigns.length,
      campaigns: incorrectCampaigns.map(c => ({
        id: c._id.toString(),
        name: c.name,
        status: c.status,
        scheduledFor: c.actual_scheduled_date,
        sent: c.stats?.sent || 0,
        issue: 'Marked as active but scheduled date is in the future'
      }))
    });
  } catch (error) {
    console.error("Error checking campaign statuses:", error);
    return NextResponse.json(
      { error: error.message || "Failed to check campaign statuses" },
      { status: 500 }
    );
  }
}
