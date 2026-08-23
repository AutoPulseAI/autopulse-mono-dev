# Campaign Cron Job Setup Guide

## Overview

The campaign system uses a cron job to automatically execute scheduled campaigns. When a campaign's scheduled time arrives, the cron job finds it and queues jobs to send messages to all leads.

## Cron URL

**Endpoint:** `POST /api/cron/campaigns`

**Full URL Examples:**
- Local: `http://localhost:3000/api/cron/campaigns`
- Production: `https://yourdomain.com/api/cron/campaigns`

## How It Works

### Step-by-Step Flow:

1. **User Creates Campaign**
   - User sets scheduled date/time (in dealer timezone)
   - System saves `scheduled_date` (UTC) and `actual_scheduled_date` (UTC for cron)
   - Campaign status: `scheduled`

2. **Cron Job Runs** (every 5 minutes recommended)
   - Calls `POST /api/cron/campaigns`
   - Finds campaigns where:
     - `status = 'scheduled'`
     - `actual_scheduled_date <= now` (within 5-minute window)
   - For each campaign:
     - Updates status to `active`
     - Queues a job for each pending lead in `campaignProcessingQueue`

3. **Worker Processes Jobs**
   - `campaignWorker.js` processes each lead job
   - Sends email/SMS based on campaign message type
   - Creates/updates Lead record in database
   - Updates `CampaignLead` status (sent/failed)
   - Updates campaign stats (sent/failed counts)

4. **Campaign Completion**
   - When all leads are processed, campaign status changes to `completed`

## Setup Options

### Option 1: External Cron Service (Recommended)

Use a service like:
- **cron-job.org**
- **EasyCron**
- **UptimeRobot**
- **Your server's crontab**

**Crontab Example:**
```bash
# Run every 5 minutes
*/5 * * * * curl -X POST https://yourdomain.com/api/cron/campaigns
```

**cron-job.org Setup:**
1. Create account at cron-job.org
2. Add new cron job:
   - URL: `https://yourdomain.com/api/cron/campaigns`
   - Method: `POST`
   - Schedule: Every 5 minutes
   - Save and activate

### Option 2: Internal Cron Service (Like Other Services)

You can create a cron service similar to `reportCronService.js` or `appointmentReminderCronService.js` that runs internally.

## API Endpoints

### POST /api/cron/campaigns
**Purpose:** Find and queue campaigns ready to execute

**Request:**
```bash
curl -X POST https://yourdomain.com/api/cron/campaigns
```

**Response:**
```json
{
  "success": true,
  "message": "Processed 2 campaign(s), queued 150 lead job(s)",
  "campaignsFound": 2,
  "totalJobsQueued": 150,
  "results": [
    {
      "campaignId": "507f1f77bcf86cd799439011",
      "campaignName": "Summer Sale Campaign",
      "leadsQueued": 75,
      "jobIds": ["job-1", "job-2", ...],
      "status": "queued"
    }
  ]
}
```

### GET /api/cron/campaigns
**Purpose:** Check status of ready/active campaigns

**Request:**
```bash
curl https://yourdomain.com/api/cron/campaigns
```

**Response:**
```json
{
  "readyCampaigns": 2,
  "activeCampaigns": 1,
  "campaigns": {
    "ready": [
      {
        "_id": "...",
        "name": "Campaign Name",
        "actual_scheduled_date": "2025-11-25T17:20:00Z",
        "status": "scheduled",
        "pendingLeads": 50
      }
    ],
    "active": [...]
  }
}
```

## Worker Setup

The campaign worker must be running to process queued jobs.

**Worker File:** `/app/worker/worker.js`

The worker automatically starts when the application starts (if running the worker process).

**To start worker separately:**
```bash
node workers/startWorker.js
```

Or ensure your application startup includes worker initialization.

## Testing

### Manual Test:
```bash
# Test the cron endpoint
curl -X POST http://localhost:3000/api/cron/campaigns

# Check status
curl http://localhost:3000/api/cron/campaigns
```

### Create Test Campaign:
1. Create a campaign with scheduled date/time in the past (or very near future)
2. Wait for cron to run (or trigger manually)
3. Check campaign status - should change from `scheduled` → `active` → `completed`
4. Check leads - should have `status: 'sent'` or `'failed'`
5. Check Lead model - all campaign leads should be in Lead collection

## Monitoring

- **Campaign Status:** Check campaign listing page
- **Queue Status:** Check Redis queue status
- **Worker Logs:** Check application logs for worker processing
- **Lead Records:** Check Lead model for created/updated leads

## Important Notes

1. **Timezone Handling:**
   - User enters date/time in dealer timezone
   - System converts to UTC and stores in `actual_scheduled_date`
   - Cron compares `actual_scheduled_date` (UTC) with current UTC time

2. **Execution Window:**
   - Cron finds campaigns within 5-minute window (past or future)
   - Won't process campaigns older than 1 hour (prevents re-processing old campaigns)

3. **Job Processing:**
   - Each lead is processed as a separate job
   - Jobs are retried up to 3 times on failure
   - Worker processes 10 leads concurrently

4. **Lead Creation:**
   - All campaign leads (CSV or database) are saved to Lead model
   - Existing leads are updated, new leads are created
   - Source is marked as `'campaign'`

## Troubleshooting

**Campaigns not executing:**
- Check if cron job is running
- Verify `actual_scheduled_date` is set correctly
- Check campaign status is `'scheduled'`
- Verify worker is running

**Leads not being sent:**
- Check worker logs for errors
- Verify Redis connection
- Check email/SMS credentials
- Verify dealer email account and SMS phone are configured

**Leads not in Lead model:**
- Check worker logs for lead creation
- Verify Lead model is being imported correctly
- Check for database connection issues

