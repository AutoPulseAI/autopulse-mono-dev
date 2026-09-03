import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Campaign from "@models/Campaign";
import User from "@models/User";
import moment from "moment-timezone";

// POST: Migrate existing campaigns to add actual_scheduled_date
export async function POST(req) {
  try {
    await dbConnect();

    // Get all campaigns that have scheduled_date but no actual_scheduled_date
    const campaigns = await Campaign.find({
      scheduled_date: { $exists: true, $ne: null },
      $or: [
        { actual_scheduled_date: { $exists: false } },
        { actual_scheduled_date: null }
      ]
    });

    console.log(`Found ${campaigns.length} campaigns to migrate`);

    let updated = 0;
    let errors = 0;

    for (const campaign of campaigns) {
      try {
        // Get dealer timezone
        const dealer = await User.findById(campaign.dealer_id);
        const dealerTimezone = dealer?.dealer_account_information?.time_zone || "America/New_York";

        if (campaign.scheduled_date) {
          // Convert scheduled_date to UTC based on dealer timezone
          const scheduledDate = new Date(campaign.scheduled_date);
          const year = scheduledDate.getUTCFullYear();
          const month = String(scheduledDate.getUTCMonth() + 1).padStart(2, '0');
          const day = String(scheduledDate.getUTCDate()).padStart(2, '0');
          const hours = String(scheduledDate.getUTCHours()).padStart(2, '0');
          const minutes = String(scheduledDate.getUTCMinutes()).padStart(2, '0');
          const seconds = String(scheduledDate.getUTCSeconds()).padStart(2, '0');
          
          const dateTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          
          // Create moment in dealer timezone
          let momentDate;
          if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
            momentDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm:ss", dealerTimezone);
          } else if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)) {
            momentDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm", dealerTimezone);
          } else {
            momentDate = moment.tz(dateTimeStr, dealerTimezone);
          }
          
          if (momentDate.isValid()) {
            // Convert to UTC
            const actualScheduledDate = momentDate.utc().toDate();
            
            // Update campaign
            await Campaign.findByIdAndUpdate(campaign._id, {
              actual_scheduled_date: actualScheduledDate
            });
            
            updated++;
            console.log(`Updated campaign ${campaign._id} with actual_scheduled_date: ${actualScheduledDate}`);
          } else {
            console.error(`Invalid date for campaign ${campaign._id}: ${dateTimeStr}`);
            errors++;
          }
        }
      } catch (err) {
        console.error(`Error updating campaign ${campaign._id}:`, err.message);
        errors++;
      }
    }

    return NextResponse.json({
      message: "Migration completed",
      total: campaigns.length,
      updated,
      errors
    }, { status: 200 });

  } catch (error) {
    console.error("Error migrating campaigns:", error);
    return NextResponse.json(
      { error: error.message || "Failed to migrate campaigns" },
      { status: 500 }
    );
  }
}

// GET: Check migration status
export async function GET(req) {
  try {
    await dbConnect();

    const total = await Campaign.countDocuments({
      scheduled_date: { $exists: true, $ne: null }
    });

    const migrated = await Campaign.countDocuments({
      scheduled_date: { $exists: true, $ne: null },
      actual_scheduled_date: { $exists: true, $ne: null }
    });

    const needsMigration = await Campaign.countDocuments({
      scheduled_date: { $exists: true, $ne: null },
      $or: [
        { actual_scheduled_date: { $exists: false } },
        { actual_scheduled_date: null }
      ]
    });

    return NextResponse.json({
      total,
      migrated,
      needsMigration
    }, { status: 200 });

  } catch (error) {
    console.error("Error checking migration status:", error);
    return NextResponse.json(
      { error: error.message || "Failed to check migration status" },
      { status: 500 }
    );
  }
}

