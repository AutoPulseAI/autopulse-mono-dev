# Appointment Reminder API - cURL Examples

## Basic Request (with required fields only)

```bash
curl -X POST http://localhost:3000/api/cron/appointment-reminder \
  -H "Content-Type: application/json" \
  -d '{
    "reminder_id": "60d5ec49f1b2c72b8c8e4b1a"
  }'
```

## Request with Custom Message

```bash
curl -X POST http://localhost:3000/api/cron/appointment-reminder \
  -H "Content-Type: application/json" \
  -d '{
    "reminder_id": "60d5ec49f1b2c72b8c8e4b1a",
    "message": "Custom reminder message here"
  }'
```

## Request for Production Server

```bash
curl -X POST https://your-domain.com/api/cron/appointment-reminder \
  -H "Content-Type: application/json" \
  -d '{
    "reminder_id": "60d5ec49f1b2c72b8c8e4b1a"
  }'
```

## Request with Authorization (if needed)

```bash
curl -X POST http://localhost:3000/api/cron/appointment-reminder \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "reminder_id": "60d5ec49f1b2c72b8c8e4b1a"
  }'
```

## Request with Pretty Print Output

```bash
curl -X POST http://localhost:3000/api/cron/appointment-reminder \
  -H "Content-Type: application/json" \
  -d '{
    "reminder_id": "60d5ec49f1b2c72b8c8e4b1a"
  }' | jq .
```

## Request with Verbose Output (for debugging)

```bash
curl -v -X POST http://localhost:3000/api/cron/appointment-reminder \
  -H "Content-Type: application/json" \
  -d '{
    "reminder_id": "60d5ec49f1b2c72b8c8e4b1a"
  }'
```

## Example Success Response

```json
{
  "success": true,
  "message": "Reminder processed successfully",
  "reminder_id": "60d5ec49f1b2c72b8c8e4b1a",
  "email_records": [
    {
      "id": "60d5ec49f1b2c72b8c8e4b1b",
      "type": "email"
    },
    {
      "id": "60d5ec49f1b2c72b8c8e4b1c",
      "type": "sms"
    }
  ]
}
```

## Example Error Responses

### Missing reminder_id
```json
{
  "error": "reminder_id is required"
}
```

### Reminder not found
```json
{
  "error": "Reminder not found"
}
```

### Reminder already processed
```json
{
  "success": true,
  "message": "Reminder already processed",
  "status": "sent"
}
```

### Lead status prevents sending
```json
{
  "error": "Lead status is DND or Managerial Review. Reminder cancelled."
}
```

## Notes

- Replace `60d5ec49f1b2c72b8c8e4b1a` with an actual `reminder_id` from your `AppointmentReminder` collection
- The endpoint will automatically determine whether to send email, SMS, or both based on:
  1. The last communication type (email or SMS) excluding notes
  2. The reminder's `reminder_type` setting
  3. Available dealer email account and SMS phone number
- If `message` is not provided, the endpoint will generate appropriate content based on the `message_type` (appointment_reminder, post_appointment, or managerial_review)

