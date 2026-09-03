# Email Attachment Implementation Summary

## Overview
Email attachments are now fully supported with automatic S3 upload and public URL generation, similar to SMS/MMS handling.

## Implementation Flow

### 1. **Email Webhook Script (`email_webhook_hestia.sh`)**
- Extracts attachments using `munpack` tool
- Filters out internal temp files (`body.txt`, `headers.txt`)
- Sends attachments via multipart/form-data to API
- Maximum attachment size: 25MB per file

### 2. **API Route (`app/api/system/route.js`)**
```javascript
// Key changes:
- Detects multipart/form-data vs JSON
- Processes FormData for email fields and attachments
- Uploads each attachment to S3 using uploadToS3()
- Generates S3 file path: email-attachments/{message_id}/{filename}
- Stores attachment metadata with public S3 URLs
```

**Attachment metadata structure:**
```javascript
{
  filename: "image.png",
  size: 308925,
  contentType: "image/png",
  url: "https://bucket.s3.region.amazonaws.com/email-attachments/...",
  s3Key: "email-attachments/...",
  status: "processed",
  uploadedAt: "2025-12-09T12:00:00.000Z"
}
```

### 3. **Database Storage (Email Model)**
- `has_attachments`: Boolean flag
- `attachments`: Array of attachment objects with S3 URLs
- Model uses `{ strict: false }` so no schema changes needed

### 4. **Worker Integration (`app/worker/emailWorker.js`)**
- Receives attachment URLs in job data
- Can process attachments for AI analysis
- Attachments available in `currentEmail.attachments` array

## S3 Configuration

### Required Environment Variables
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_BUCKET_NAME=your-bucket-name
```

### S3 Bucket Setup
1. Create S3 bucket
2. Enable public read access (or use signed URLs)
3. Set CORS policy if accessing from web:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": []
  }
]
```

## File Structure

```
email-attachments/
  ├── {message_id_1}/
  │   ├── image.png
  │   └── document.pdf
  ├── {message_id_2}/
  │   └── file.xlsx
```

## API Response Example

```json
{
  "message": "Email logged and sent to queue",
  "data": {
    "_id": "...",
    "sender": "user@example.com",
    "recipient": "dealer@autopulsemail.com",
    "subject": "Inquiry about vehicle",
    "has_attachments": true,
    "attachments": [
      {
        "filename": "image.png",
        "size": 308925,
        "contentType": "image/png",
        "url": "https://bucket.s3.amazonaws.com/email-attachments/...",
        "status": "processed"
      }
    ]
  },
  "attachments_received": 1,
  "attachments": [
    { "filename": "image.png", "size": 308925 }
  ]
}
```

## Error Handling

### Attachment Upload Fails
- Error is logged but doesn't block email processing
- Attachment marked with `status: "failed"` and `error` message
- Email is still saved and queued

### munpack Not Installed
- Warning logged in webhook log
- Attachments won't be extracted from email
- Email body and other data still processed normally

## Testing

### Test Email with Attachment
1. Send email to `dealer@autopulsemail.com` with attachment
2. Check webhook log: `/tmp/email_webhook_log.txt`
3. Verify attachment uploaded to S3
4. Check email document in MongoDB for attachment URLs

### Expected Log Output
```bash
=== [Date] Email webhook START ===
munpack status: installed
[DEBUG] munpack is available, attempting extraction
[DEBUG] Found attachment: /tmp/.../image.png (308925 bytes)
Attachments found: 1
[INFO] Sending webhook with 1 attachments
[DEBUG] Curl exit code: 0
[DEBUG] HTTP status code: 200
[OK] Webhook sent successfully
```

### Expected Server Log
```
Processing attachment: image.png (308925 bytes)
Starting S3 upload: email-attachments/...
S3 upload successful: image.png -> https://...
✓ Attachment uploaded to S3: image.png -> https://...
Processed 1 attachment(s)
```

## Comparison with SMS/MMS Flow

| Feature | SMS/MMS | Email |
|---------|---------|-------|
| Source | Twilio webhook | Exim4 + bash script |
| Extraction | Twilio provides URLs | munpack extracts files |
| Upload timing | Worker downloads then uploads | Route uploads immediately |
| Storage | processAndUploadMedia() | uploadToS3() |
| File path | `media/{dealer}/{message}/` | `email-attachments/{message}/` |

## Future Enhancements

1. **Virus Scanning**: Add ClamAV scan before S3 upload
2. **Image Processing**: Generate thumbnails for images
3. **Attachment Viewer**: Frontend component to display attachments
4. **AI Analysis**: Process attachments in worker for content analysis
5. **Retention Policy**: Automatic deletion of old attachments

## Troubleshooting

### Attachments Not Appearing
- Check if `munpack` is installed: `which munpack`
- Verify S3 credentials in environment variables
- Check S3 bucket permissions
- Review webhook logs for errors

### Large Attachments Failing
- Current limit: 25MB per file
- Increase in script if needed: `MAX_ATTACHMENT_SIZE`
- Check S3 bucket upload limits
- Verify timeout settings in curl

### S3 Upload Errors
- Verify AWS credentials
- Check S3 bucket exists
- Verify bucket is in correct region
- Check IAM permissions for `s3:PutObject`

## Installation Commands

```bash
# Install munpack (for attachment extraction)
sudo apt-get update && sudo apt-get install mpack -y

# Verify installation
which munpack
munpack -v

# Deploy updated webhook script
sudo nano /usr/local/bin/email_webhook_hestia.sh
# (paste updated script)
sudo chmod +x /usr/local/bin/email_webhook_hestia.sh

# Restart application (if needed)
pm2 restart all
```

## Files Modified

1. ✅ `email_webhook_hestia.sh` - Attachment extraction & sending
2. ✅ `app/api/system/route.js` - S3 upload & metadata storage
3. ✅ `app/lib/aws-s3.js` - Already had upload functions (no changes)
4. ✅ `app/models/Email.js` - Already supports dynamic fields (no changes)
5. ℹ️ `app/worker/emailWorker.js` - Can now access attachment URLs

## Status: ✅ READY FOR PRODUCTION

All components are implemented and tested. Attachments will be automatically:
- Extracted from incoming emails
- Uploaded to S3
- Stored with public URLs
- Available to workers for processing

