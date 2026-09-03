# .eml File Approach for Large Emails

## 🎯 **Problem Solved:**

When emails are very large (>5MB) with multiple attachments, sending the entire body/headers in JSON causes:
- ❌ Buffer overflow errors (`offset out of range`)
- ❌ Command-line argument limits exceeded
- ❌ Memory issues in Node.js

## ✅ **Solution: Upload .eml to S3**

Instead of sending large body/headers in JSON, we:
1. **Upload entire email as `.eml` file to S3**
2. **Send only the S3 URL** in JSON payload
3. **API can download and parse** `.eml` if needed
4. **Individual attachments still extracted** and uploaded separately

---

## 📋 **How It Works:**

### **1. Bash Script (`email_webhook_simple_with_s3.sh`):**

```bash
# Check email size
EMAIL_SIZE=${#EMAIL_CONTENT}
LARGE_EMAIL_THRESHOLD=$((5 * 1024 * 1024))  # 5MB

if [ "$EMAIL_SIZE" -gt "$LARGE_EMAIL_THRESHOLD" ]; then
  # Upload entire email as .eml
  aws s3 cp "$TEMP_EMAIL" "s3://bucket/email-attachments/.../email.eml"
  EMAIL_EML_URL="https://bucket.s3.amazonaws.com/..."
fi

# Send JSON with .eml URL
{
  "body": "truncated body...",
  "headers": "...",
  "eml_url": "https://.../email.eml",  ← Full email available here
  "attachments": [...]
}
```

### **2. API Route (`app/api/system/route.js`):**

```javascript
// Receives JSON with eml_url
if (data.eml_url) {
  console.log(`Large email - .eml file at: ${data.eml_url}`);
  // Store URL for reference
  newEmail.eml_file_url = data.eml_url;
}

// Can download and parse later if needed:
// const parsed = await parseEmlFromS3(data.eml_url);
```

---

## 📊 **JSON Payload Structure:**

### **Small Email (< 5MB):**
```json
{
  "sender": "user@example.com",
  "recipient": "dealer@autopulsemail.com",
  "subject": "Small email",
  "body": "Full email body here...",
  "headers": "Full headers here...",
  "attachments": [],
  "eml_url": null
}
```

### **Large Email (≥ 5MB):**
```json
{
  "sender": "user@example.com",
  "recipient": "dealer@autopulsemail.com",
  "subject": "Large email with attachments",
  "body": "Truncated body (first 10KB)...",
  "headers": "Full headers...",
  "eml_url": "https://autopulseai.s3.amazonaws.com/email-attachments/.../email.eml",
  "attachments": [
    {
      "filename": "document.pdf",
      "url": "https://.../document.pdf",
      "size": 1048576,
      "status": "processed"
    }
  ]
}
```

---

## 🔧 **Configuration:**

### **Threshold (in script):**
```bash
LARGE_EMAIL_THRESHOLD=$((5 * 1024 * 1024))  # 5MB
```

**Adjust if needed:**
- Lower (e.g., 1MB) = More .eml uploads, smaller JSON payloads
- Higher (e.g., 10MB) = Fewer .eml uploads, larger JSON payloads

---

## 📁 **S3 Structure:**

```
s3://autopulseai/email-attachments/
  ├── <message-id-1>/
  │   ├── 1734354151000000000_email.eml          ← Full email
  │   ├── 1734354151000000001_document.pdf       ← Attachment 1
  │   └── 1734354151000000002_image.jpg          ← Attachment 2
  ├── <message-id-2>/
  │   └── 1734354152000000000_email.eml
  └── ...
```

---

## 🧪 **Testing:**

### **Test with curl:**

```bash
# Small email (no .eml)
curl -X POST "https://www.autopulse.ai/api/system" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "test@example.com",
    "recipient": "test@autopulsemail.com",
    "subject": "Test",
    "message_id": "<test@example.com>",
    "body": "Small email body",
    "headers": "From: test@example.com",
    "attachments": []
  }'

# Large email (with .eml URL)
curl -X POST "https://www.autopulse.ai/api/system" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "test@example.com",
    "recipient": "test@autopulsemail.com",
    "subject": "Large Email",
    "message_id": "<test-large@example.com>",
    "body": "Truncated body...",
    "headers": "From: test@example.com",
    "eml_url": "https://autopulseai.s3.amazonaws.com/email-attachments/test/email.eml",
    "attachments": [...]
  }'
```

---

## 💡 **Benefits:**

| Feature | Before | After |
|---------|--------|-------|
| **Large emails** | ❌ Buffer overflow | ✅ Works perfectly |
| **JSON size** | ❌ 17MB+ payloads | ✅ < 100KB payloads |
| **Memory usage** | ❌ High | ✅ Low |
| **Parsing** | ❌ Limited | ✅ Full .eml available |
| **Attachments** | ✅ Extracted | ✅ Extracted + .eml |

---

## 🔄 **Future Enhancements:**

### **1. Parse .eml in API (if needed):**

```javascript
import { parseEmlFromS3 } from '@lib/parseEmlFile';

if (data.eml_url && !data.body) {
  const parsed = await parseEmlFromS3(data.eml_url);
  data.body = parsed.body;
  data.headers = parsed.headers;
}
```

### **2. Extract attachments from .eml:**

```javascript
import { extractAttachmentsFromEml } from '@lib/parseEmlFile';

if (data.eml_url && attachments.length === 0) {
  const parsed = await parseEmlFromS3(data.eml_url);
  const emlAttachments = extractAttachmentsFromEml(parsed.raw);
  attachments = emlAttachments;
}
```

### **3. Use mailparser library:**

For production, consider using `mailparser` npm package:

```bash
npm install mailparser
```

```javascript
import { simpleParser } from 'mailparser';

const parsed = await simpleParser(emlContent);
// Returns structured email with attachments, HTML, text, etc.
```

---

## 📝 **Database Schema:**

The Email model now stores:

```javascript
{
  // ... existing fields ...
  mail_content: "truncated body...",  // First 10KB for preview
  eml_file_url: "https://.../email.eml",  // Full email URL
  attachments: [
    {
      filename: "doc.pdf",
      url: "https://.../doc.pdf",
      // ...
    }
  ]
}
```

---

## 🚀 **Deployment:**

1. **Deploy updated script:**
   ```bash
   sudo cp email_webhook_simple_with_s3.sh /usr/local/bin/email_webhook_hestia.sh
   sudo chmod +x /usr/local/bin/email_webhook_hestia.sh
   ```

2. **Test with large email:**
   ```bash
   tail -f /tmp/email_webhook_log.txt
   ```

3. **Verify .eml upload:**
   ```bash
   aws s3 ls s3://autopulseai/email-attachments/ --recursive | grep "\.eml$"
   ```

---

## ✅ **Status:**

- ✅ Script updated to upload .eml for large emails
- ✅ API route handles eml_url
- ✅ Database stores eml_file_url
- ✅ Helper functions created for parsing
- ✅ Test scripts provided

**Ready for production!** 🎉

