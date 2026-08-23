# .eml File Only Approach

## 🎯 **What Changed:**

**Before:** Body and headers were sent in JSON payload (causing buffer overflow for large emails)

**After:** 
- ✅ **Always upload entire email as `.eml` file to S3**
- ✅ **Send only metadata in JSON** (no body/headers)
- ✅ **Parse body/headers from `.eml` file in `route.js`**

---

## 📋 **How It Works:**

### **1. Bash Script (`email_webhook_simple_with_s3.sh`):**

```bash
# Always upload .eml file (no size threshold)
aws s3 cp "$TEMP_EMAIL" "s3://bucket/email-attachments/.../email.eml"

# Send JSON with ONLY metadata (no body/headers)
{
  "sender": "...",
  "recipient": "...",
  "subject": "...",
  "message_id": "...",
  "eml_url": "https://.../email.eml",  ← Full email here
  "attachments": [...]
}
```

### **2. API Route (`app/api/system/route.js`):**

```javascript
// Download and parse .eml file
if (data.eml_url) {
  const emlResponse = await fetch(data.eml_url);
  const emlContent = await emlResponse.text();
  
  // Parse headers and body
  const headerBodySplit = emlContent.indexOf('\n\n');
  data.headers = emlContent.substring(0, headerBodySplit);
  data.body = emlContent.substring(headerBodySplit + 2);
  
  // Handle multipart, quoted-printable, etc.
  // ...
}
```

---

## 📊 **JSON Payload Structure:**

### **New Structure (No Body/Headers):**

```json
{
  "sender": "user@example.com",
  "recipient": "dealer@autopulsemail.com",
  "subject": "Test Email",
  "message_id": "<test@example.com>",
  "in_reply_to": "",
  "references": "",
  "first_message_id": "",
  "last_message_id": "",
  "parent_conversation": "",
  "base_parent_id": "<test@example.com>",
  "date": "Tue, 16 Dec 2025 11:22:31 +0000",
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

**Note:** `body` and `headers` are **NOT** in JSON - they are parsed from `.eml` file!

---

## 🔧 **Parsing Logic in route.js:**

The route.js now:

1. **Downloads `.eml` file** from S3 URL
2. **Splits headers and body** (at first `\n\n`)
3. **Handles multipart emails** (extracts text/html or text/plain)
4. **Decodes quoted-printable** if needed
5. **Sets `data.body` and `data.headers`** for processing

---

## ✅ **Benefits:**

| Feature | Before | After |
|---------|--------|-------|
| **JSON size** | ❌ 17MB+ payloads | ✅ < 5KB payloads |
| **Buffer overflow** | ❌ Common | ✅ Never |
| **Memory usage** | ❌ High | ✅ Low |
| **Parsing** | ❌ Limited | ✅ Full .eml parsing |
| **Reliability** | ❌ Fragile | ✅ Robust |

---

## 🧪 **Testing:**

### **Test curl command:**

```bash
curl -X POST "https://www.autopulse.ai/api/system" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "test@example.com",
    "recipient": "test@autopulsemail.com",
    "subject": "Test Email",
    "message_id": "<test@example.com>",
    "date": "Tue, 16 Dec 2025 11:22:31 +0000",
    "eml_url": "https://autopulseai.s3.amazonaws.com/email-attachments/test/email.eml",
    "attachments": []
  }'
```

**Important:** The `.eml` file must exist at the URL for this to work!

---

## 📁 **S3 Structure:**

```
s3://autopulseai/email-attachments/
  ├── <message-id-1>/
  │   ├── 1734354151000000000_email.eml          ← Full email (always uploaded)
  │   ├── 1734354151000000001_document.pdf       ← Attachment 1
  │   └── 1734354151000000002_image.jpg          ← Attachment 2
  └── ...
```

---

## 🔄 **Flow Diagram:**

```
1. Email received by Exim4
   ↓
2. Script extracts metadata (sender, recipient, subject, etc.)
   ↓
3. Script uploads entire email as .eml to S3
   ↓
4. Script sends JSON with metadata + eml_url (NO body/headers)
   ↓
5. route.js receives JSON
   ↓
6. route.js downloads .eml from S3
   ↓
7. route.js parses .eml to extract body and headers
   ↓
8. route.js processes email with parsed body/headers
```

---

## ⚠️ **Error Handling:**

### **If `.eml` upload fails:**
- Script logs error but continues
- JSON sent with `eml_url: null`
- route.js will have empty body/headers (handled gracefully)

### **If `.eml` download fails:**
- route.js logs error
- Continues with empty body/headers
- Email still saved with metadata

### **If `.eml` parsing fails:**
- route.js logs error
- Uses empty body/headers as fallback
- Email still processed

---

## 🚀 **Deployment:**

1. **Deploy updated script:**
   ```bash
   sudo cp email_webhook_simple_with_s3.sh /usr/local/bin/email_webhook_hestia.sh
   sudo chmod +x /usr/local/bin/email_webhook_hestia.sh
   ```

2. **Test with real email:**
   ```bash
   tail -f /tmp/email_webhook_log.txt
   ```

3. **Verify .eml upload:**
   ```bash
   aws s3 ls s3://autopulseai/email-attachments/ --recursive | grep "\.eml$"
   ```

4. **Check API logs:**
   - Look for "Parsing .eml file" messages
   - Verify body/headers are extracted correctly

---

## 📝 **Code Changes Summary:**

### **Script Changes:**
- ✅ Always upload `.eml` (removed size threshold)
- ✅ Removed `body` and `headers` from JSON payload
- ✅ Only send metadata + `eml_url` + `attachments`

### **Route Changes:**
- ✅ Download `.eml` file from S3
- ✅ Parse headers and body from `.eml`
- ✅ Handle multipart emails
- ✅ Decode quoted-printable
- ✅ Error handling for failed downloads/parsing

---

## ✅ **Status:**

- ✅ Script updated to always upload .eml
- ✅ Body/headers removed from JSON payload
- ✅ route.js parses .eml file
- ✅ Error handling added
- ✅ Test scripts provided

**Ready for production!** 🎉

