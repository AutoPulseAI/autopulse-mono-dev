#!/bin/bash
#
# Test Email Webhook with .eml file approach
# Body and headers are parsed from .eml file in route.js
#

echo "=== Test: Email with .eml file (body/headers parsed server-side) ==="
curl -X POST "https://www.autopulse.ai/api/system" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "test@example.com",
    "recipient": "test@autopulsemail.com",
    "subject": "Test Email with .eml",
    "message_id": "<test-eml-123@example.com>",
    "in_reply_to": "",
    "references": "",
    "first_message_id": "",
    "last_message_id": "",
    "parent_conversation": "",
    "base_parent_id": "<test-eml-123@example.com>",
    "date": "Tue, 16 Dec 2025 11:22:31 +0000",
    "eml_url": "https://autopulseai.s3.us-east-1.amazonaws.com/email-attachments/test-eml-123/1734354151000000000_email.eml",
    "attachments": [
      {
        "filename": "document.pdf",
        "size": 1048576,
        "contentType": "application/pdf",
        "url": "https://autopulseai.s3.us-east-1.amazonaws.com/email-attachments/test-eml-123/1734354151000000000_document.pdf",
        "s3Key": "email-attachments/test-eml-123/1734354151000000000_document.pdf",
        "status": "processed",
        "uploadedAt": "2025-12-16T11:22:31.000Z"
      }
    ]
  }'

echo -e "\n\n"
echo "=== Note: body and headers are NOT in JSON - they are parsed from .eml_url ==="

