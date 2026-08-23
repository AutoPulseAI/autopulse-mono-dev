#!/bin/bash
#
# Test Email Webhook with .eml file support
#

# Test 1: Small email (body/headers inline)
echo "=== Test 1: Small Email (inline body/headers) ==="
curl -X POST "https://www.autopulse.ai/api/system" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "test@example.com",
    "recipient": "test@autopulsemail.com",
    "subject": "Small Test Email",
    "message_id": "<test-small-123@example.com>",
    "in_reply_to": "",
    "references": "",
    "first_message_id": "",
    "last_message_id": "",
    "parent_conversation": "",
    "base_parent_id": "<test-small-123@example.com>",
    "date": "Tue, 16 Dec 2025 11:22:31 +0000",
    "body": "This is a small test email body.",
    "headers": "From: test@example.com\nTo: test@autopulsemail.com\nSubject: Small Test Email",
    "attachments": []
  }'

echo -e "\n\n"

# Test 2: Large email with .eml file URL
echo "=== Test 2: Large Email (with .eml file URL) ==="
curl -X POST "https://www.autopulse.ai/api/system" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "test@example.com",
    "recipient": "test@autopulsemail.com",
    "subject": "Large Email with Attachments",
    "message_id": "<test-large-456@example.com>",
    "in_reply_to": "",
    "references": "",
    "first_message_id": "",
    "last_message_id": "",
    "parent_conversation": "",
    "base_parent_id": "<test-large-456@example.com>",
    "date": "Tue, 16 Dec 2025 11:22:31 +0000",
    "body": "This is a truncated body for large email. Full content available in .eml file.",
    "headers": "From: test@example.com\nTo: test@autopulsemail.com\nSubject: Large Email with Attachments\nContent-Type: multipart/mixed",
    "eml_url": "https://autopulseai.s3.us-east-1.amazonaws.com/email-attachments/test-large-456/1734354151000000000_email.eml",
    "attachments": [
      {
        "filename": "document.pdf",
        "size": 1048576,
        "contentType": "application/pdf",
        "url": "https://autopulseai.s3.us-east-1.amazonaws.com/email-attachments/test-large-456/1734354151000000000_document.pdf",
        "s3Key": "email-attachments/test-large-456/1734354151000000000_document.pdf",
        "status": "processed",
        "uploadedAt": "2025-12-16T11:22:31.000Z"
      },
      {
        "filename": "image.jpg",
        "size": 2097152,
        "contentType": "image/jpeg",
        "url": "https://autopulseai.s3.us-east-1.amazonaws.com/email-attachments/test-large-456/1734354151000000000_image.jpg",
        "s3Key": "email-attachments/test-large-456/1734354151000000000_image.jpg",
        "status": "processed",
        "uploadedAt": "2025-12-16T11:22:31.000Z"
      }
    ]
  }'

echo -e "\n\n"

# Test 3: Email with .eml but no individual attachments extracted
echo "=== Test 3: Email with .eml only (attachments in .eml) ==="
curl -X POST "https://www.autopulse.ai/api/system" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "test@example.com",
    "recipient": "test@autopulsemail.com",
    "subject": "Email with .eml file",
    "message_id": "<test-eml-789@example.com>",
    "in_reply_to": "",
    "references": "",
    "first_message_id": "",
    "last_message_id": "",
    "parent_conversation": "",
    "base_parent_id": "<test-eml-789@example.com>",
    "date": "Tue, 16 Dec 2025 11:22:31 +0000",
    "body": "Email body truncated. See .eml file for full content.",
    "headers": "From: test@example.com\nTo: test@autopulsemail.com\nSubject: Email with .eml file",
    "eml_url": "https://autopulseai.s3.us-east-1.amazonaws.com/email-attachments/test-eml-789/1734354151000000000_email.eml",
    "attachments": []
  }'

echo -e "\n\n"
echo "=== Tests Complete ==="

