# Appointment Reminder Cron Service Usage

## Overview

This cron service automatically queries pending `AppointmentReminder` records and triggers the `/api/cron/appointment-reminder` endpoint via HTTP for each reminder.

## Features

- ✅ Queries reminders by both `booking_id` and `lead_id`
- Supports all message types: `appointment_reminder`, `post_appointment`, `managerial_review`
- ✅ Calls the HTTP endpoint `/api/cron/appointment-reminder` for each reminder
- ✅ Handles errors and retries (max 3 attempts)
- ✅ Updates reminder status on success/failure

## API Endpoints

### Control the Cron Service

**Start the service:**
```bash
# GET request
curl 'http://localhost:3000/api/cron/appointment-reminder-service?action=start'

# POST request
curl -X POST 'http://localhost:3000/api/cron/appointment-reminder-service' \
  -H 'Content-Type: application/json' \
  -d '{"action": "start", "intervalMinutes": 5}'
```

**Stop the service:**
```bash
curl 'http://localhost:3000/api/cron/appointment-reminder-service?action=stop'
```

**Process reminders manually (one-time):**
```bash
curl 'http://localhost:3000/api/cron/appointment-reminder-service?action=process'
```

**Check status:**
```bash
curl 'http://localhost:3000/api/cron/appointment-reminder-service?action=status'
```

## How It Works

1. **Service queries** `AppointmentReminder` collection for:
   - `status: 'pending'`
   - `scheduled_for: { $lte: currentTime }` (due or past due)
   - `attempt_count: { $lt: 3 }` (max 3 attempts)

2. **For each reminder**, it calls:
   ```
   POST /api/cron/appointment-reminder
   {
     "reminder_id": "...",
     "message": "..." // Optional - overrides auto-generated message
   }
   ```

3. **The endpoint** (`/api/cron/appointment-reminder`) handles:
   - Sending email/SMS
   - Creating Email records
   - Updating reminder status
   - DealerSocket integration

## Configuration

### Environment Variables

Set the base URL for API calls:
- `NEXT_PUBLIC_APP_URL` (preferred)
- `APP_URL` (fallback)
- Defaults to `http://localhost:3000` if neither is set

### Interval

Default interval is 5 minutes. You can customize when starting:
```javascript
appointmentReminderCronService.start(10); // Check every 10 minutes
```

## Example Usage

### Start the cron service (checks every 5 minutes)
```bash
curl -X POST 'http://localhost:3000/api/cron/appointment-reminder-service' \
  -H 'Content-Type: application/json' \
  -d '{"action": "start", "intervalMinutes": 5}'
```

### Process reminders immediately (one-time)
```bash
curl 'http://localhost:3000/api/cron/appointment-reminder-service?action=process'
```

### Check if service is running
```bash
curl 'http://localhost:3000/api/cron/appointment-reminder-service?action=status'
```

Response:
```json
{
  "success": true,
  "message": "Appointment reminder cron service status",
  "status": {
    "isRunning": true,
    "lastProcessed": "2025-01-15T10:30:00.000Z",
    "nextCheck": "2025-01-15T10:35:00.000Z"
  }
}
```

## Direct Reminder Trigger

You can also trigger a specific reminder directly:

```bash
curl --location 'http://localhost:3000/api/cron/appointment-reminder' \
--header 'Content-Type: application/json' \
--data '{
    "reminder_id": "6905893c1217be65ab562d28",
    "message": "Custom reminder message here"
}'
```

## Message Types Supported

1. **appointment_reminder** - Pre-appointment reminders
2. **post_appointment** - Post-appointment follow-ups
3. **managerial_review** - Managerial review follow-up messages

All types are automatically handled by the cron service and the endpoint.

