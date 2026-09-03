# Appointment Reminder Cron Service

## Overview

The appointment reminder cron service automatically processes pending reminders from the `AppointmentReminder` collection. It supports all three message types:
- `appointment_reminder` - Pre-appointment reminders
- `post_appointment` - Post-appointment follow-ups
- `managerial_review` - Managerial review follow-up messages

## How It Works

### 1. Querying Reminders

The service queries `AppointmentReminder` documents with:
- `status: 'pending'`
- `scheduled_for: { $lte: currentTime }` (due or past due)
- `attempt_count: { $lt: 3 }` (max 3 attempts)

It supports both:
- **`booking_id`** - For appointment reminders and post-appointment messages
- **`lead_id`** - For managerial review messages

### 2. Processing Flow

1. **`getPendingReminders(currentTime, leadId)`** - Queries pending reminders
   - If `leadId` is provided, filters by that specific lead
   - Otherwise, gets all pending reminders

2. **`processAllPendingReminders()`** - Processes all pending reminders
   - Calls `/api/cron/appointment-reminder` endpoint via HTTP for each reminder
   - Sends `reminder_id` in the request body
   - Optional `message` field can override auto-generated content

3. **`processRemindersForLead(leadId)`** - Processes reminders for a specific lead
   - Useful for triggering reminders when a lead status changes
   - Same HTTP endpoint call as above

### 3. API Endpoint

The service triggers the existing endpoint:
```
POST /api/cron/appointment-reminder
```

**Request Body:**
```json
{
  "reminder_id": "6905893c1217be65ab562d28",
  "message": "Custom reminder message here" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Reminder processed successfully",
  "reminder_id": "6905893c1217be65ab562d28",
  "email_records": [
    { "id": "...", "type": "email" },
    { "id": "...", "type": "sms" }
  ]
}
```

## Usage

### Automatic Processing (Cron)

The service is integrated with `reminderCronService.js` which runs periodically:

```javascript
import reminderCronService from '@lib/reminderCronService';

// Start the cron service (checks every 5 minutes by default)
reminderCronService.start();

// Or with custom interval
reminderCronService.start(10); // Check every 10 minutes

// Stop the service
reminderCronService.stop();

// Process manually
await reminderCronService.processReminders();
```

### Manual Processing

```javascript
import { processAllPendingReminders, processRemindersForLead } from '@lib/appointmentReminderService';

// Process all pending reminders
const result = await processAllPendingReminders();
console.log(result); // { processed: 5, success: 4, failed: 1 }

// Process reminders for a specific lead
const leadResult = await processRemindersForLead('68f2363a8099b416939ae1e0');
console.log(leadResult); // { processed: 2, success: 2, failed: 0 }
```

### Direct API Call (Curl)

You can also trigger reminders directly via curl:

```bash
curl --location 'http://localhost:3000/api/cron/appointment-reminder' \
--header 'Content-Type: application/json' \
--data '{
    "reminder_id": "6905893c1217be65ab562d28",
    "message": "Custom reminder message here"
}'
```

## Message Types

### 1. Appointment Reminder (`appointment_reminder`)
- Triggered before appointments
- Uses `booking_id` or `lead_id`
- Content includes appointment date and time

### 2. Post Appointment (`post_appointment`)
- Triggered after appointments
- Uses `booking_id` or `lead_id`
- Content asks for feedback

### 3. Managerial Review (`managerial_review`)
- Triggered when lead status changes to "Managerial Review"
- Uses `lead_id`
- Content references the status change date
- Can be sent even if lead status is "DND"

## Configuration

### Environment Variables

The service uses these environment variables for the base URL:
- `NEXT_PUBLIC_APP_URL` (preferred)
- `APP_URL` (fallback)
- Defaults to `http://localhost:3000` if neither is set

### Reminder Data Structure

Each reminder includes:
```javascript
{
  dealer_id: ObjectId,
  booking_id: ObjectId, // For appointment reminders
  lead_id: ObjectId,     // For managerial review
  customer_name: String,
  customer_email: String,
  customer_phone: String,
  appointment_date: Date,
  appointment_time: String,
  reminder_type: 'email' | 'sms' | 'both',
  message_type: 'appointment_reminder' | 'post_appointment' | 'managerial_review',
  scheduled_for: Date,
  status: 'pending' | 'sent' | 'failed' | 'cancelled',
  attempt_count: Number,
  max_attempts: Number,
  reminder_data: {
    interval_hours: Number,
    reminder_number: Number,
    total_reminders: Number,
    dealer_timezone: String,
    appointment_datetime_local: String,
    scheduled_for_local: String,
    // For managerial_review:
    status_changed_at_local: String
  }
}
```

## Error Handling

- Failed API calls increment `attempt_count`
- After 3 failed attempts, status changes to `failed`
- Error messages are stored in `error_message` field
- Reminders with status `sent` or `failed` are skipped

## Example: Managerial Review Flow

1. Lead status changes to "Managerial Review"
2. `createManagerialReviewMessages(leadId, dealerId)` creates reminder records
3. Cron service picks up reminders when `scheduled_for` time arrives
4. Service calls `/api/cron/appointment-reminder` with `reminder_id`
5. Endpoint sends email/SMS and creates `Email` records
6. Reminder status updated to `sent`

## Notes

- The service uses HTTP calls to the API endpoint, not direct database operations
- This allows the endpoint to handle all business logic (email/SMS sending, Email record creation, DealerSocket integration)
- Custom messages can override auto-generated content
- All message types are supported through the same endpoint

