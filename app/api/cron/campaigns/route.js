import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb.js';
import Campaign from '@models/Campaign.js';
import CampaignLead from '@models/CampaignLead.js';
import { getQueue } from '@lib/queue.js';

/**
 * POST endpoint for cron-triggered campaign execution
 * Finds campaigns ready to execute and queues jobs for each lead
 */
export async function POST(request) {
  try {
    await dbConnect();
    
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000); // 5 minute window
    
    // Find campaigns that are scheduled and ready to execute
    // actual_scheduled_date is in UTC, so we compare with current UTC time
    const readyCampaigns = await Campaign.find({
      status: 'scheduled',
      actual_scheduled_date: {
        $lte: fiveMinutesFromNow, // Execute if scheduled time has passed (within 5 min window)
        $gte: new Date(now.getTime() - 60 * 60 * 1000) // Don't process campaigns older than 1 hour
      }
    }).lean();

    if (readyCampaigns.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No campaigns ready to execute',
        campaignsFound: 0
      });
    }

    console.log(`Found ${readyCampaigns.length} campaign(s) ready to execute`);

    const campaignQueue = await getQueue('campaignProcessingQueue');
    let totalJobsQueued = 0;
    const results = [];

    for (const campaign of readyCampaigns) {
      try {
        // Get all pending leads for this campaign
        const campaignIdStr = campaign._id.toString();
        const pendingLeads = await CampaignLead.find({
          campaign_id: campaignIdStr,
          status: 'pending'
        }).lean();

        if (pendingLeads.length === 0) {
          console.log(`Campaign ${campaign._id} has no pending leads, marking as completed`);
          await Campaign.findByIdAndUpdate(campaign._id, {
            status: 'completed'
          });
          results.push({
            campaignId: campaign._id.toString(),
            campaignName: campaign.name,
            leadsQueued: 0,
            status: 'completed'
          });
          continue;
        }

        // Double-check: Only set to active if scheduled time has actually passed
        const scheduledTime = new Date(campaign.actual_scheduled_date);
        const currentTime = new Date();
        
        if (scheduledTime > currentTime) {
          console.log(`⚠️ Skipping campaign ${campaign._id} (${campaign.name}) - scheduled time is in the future: ${scheduledTime.toISOString()} > ${currentTime.toISOString()}`);
          continue; // Skip this campaign, it's not ready yet
        }
        
        console.log(`✅ Setting campaign ${campaign._id} (${campaign.name}) to active - scheduled time has passed: ${scheduledTime.toISOString()} <= ${currentTime.toISOString()}`);
        
        // Update campaign status to active
        await Campaign.findByIdAndUpdate(campaign._id, {
          status: 'active'
        });

        // Queue a job for each lead
        const jobs = [];
        for (const lead of pendingLeads) {
          const job = await campaignQueue.add('processCampaignLead', {
            campaignId: campaign._id.toString(),
            campaignLeadId: lead._id.toString(),
            campaignName: campaign.name,
            messageType: campaign.message_type,
            messageSubject: campaign.message_content?.subject || '',
            messageBody: campaign.message_content?.body || '',
            attachments: campaign.attachments || [], // Include attachments
            leadName: lead.name,
            leadEmail: lead.email,
            leadPhone: lead.phone,
            leadId:  lead.lead_id,
            dealerId: campaign.dealer_id.toString()
          }, {
            attempts: 3, // Retry up to 3 times
            backoff: {
              type: 'exponential',
              delay: 2000 // Start with 2 second delay
            },
            removeOnComplete: 100, // Keep last 100 completed jobs
            removeOnFail: 50 // Keep last 50 failed jobs
          });
          jobs.push(job.id);
        }

        totalJobsQueued += jobs.length;
        console.log(`Queued ${jobs.length} jobs for campaign ${campaign._id} (${campaign.name})`);

        results.push({
          campaignId: campaign._id.toString(),
          campaignName: campaign.name,
          leadsQueued: jobs.length,
          jobIds: jobs,
          status: 'queued'
        });

      } catch (err) {
        console.error(`Error processing campaign ${campaign._id}:`, err);
        results.push({
          campaignId: campaign._id.toString(),
          campaignName: campaign.name,
          error: err.message,
          status: 'error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${readyCampaigns.length} campaign(s), queued ${totalJobsQueued} lead job(s)`,
      campaignsFound: readyCampaigns.length,
      totalJobsQueued,
      results
    });

  } catch (err) {
    console.error('Error in campaign cron route:', err);
    return NextResponse.json({ 
      error: err.message || 'Failed to process campaigns' 
    }, { status: 500 });
  }
}

/**
 * GET endpoint to check campaign execution status
 */
export async function GET(request) {
  try {
    await dbConnect();
    
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    
    const readyCampaigns = await Campaign.find({
      status: 'scheduled',
      actual_scheduled_date: {
        $lte: fiveMinutesFromNow,
        $gte: new Date(now.getTime() - 60 * 60 * 1000)
      }
    }).select('_id name actual_scheduled_date status stats').lean();

    const activeCampaigns = await Campaign.find({
      status: 'active'
    }).select('_id name stats').lean();

    // Get pending leads count for ready campaigns
    const campaignIds = readyCampaigns.map(c => c._id);
    const pendingLeadsCount = await CampaignLead.aggregate([
      {
        $match: {
          campaign_id: { $in: campaignIds },
          status: 'pending'
        }
      },
      {
        $group: {
          _id: '$campaign_id',
          count: { $sum: 1 }
        }
      }
    ]);

    const pendingMap = {};
    pendingLeadsCount.forEach(item => {
      pendingMap[item._id.toString()] = item.count;
    });

    readyCampaigns.forEach(campaign => {
      campaign.pendingLeads = pendingMap[campaign._id.toString()] || 0;
    });

    return NextResponse.json({
      readyCampaigns: readyCampaigns.length,
      activeCampaigns: activeCampaigns.length,
      campaigns: {
        ready: readyCampaigns,
        active: activeCampaigns
      }
    });

  } catch (err) {
    console.error('Error checking campaign status:', err);
    return NextResponse.json({ 
      error: err.message || 'Failed to check campaign status' 
    }, { status: 500 });
  }
}

