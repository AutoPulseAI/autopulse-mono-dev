# Campaign Tracking & Reporting - Mailgun & Twilio Webhook Implementation

## 🎯 Overview

This implementation uses **Mailgun** for email and **Twilio** for SMS with **automatic tracking via webhooks**. 

**Key Advantage**: No need to modify message content! Mailgun and Twilio handle tracking automatically and send events to your server via webhooks.

---

## 📊 Available Metrics

All these metrics are automatically tracked:

### ✅ For Both Email & SMS:
1. **Status** - Campaign status (draft, scheduled, active, completed)
2. **Campaign ID** - Unique identifier
3. **Created At** - Campaign creation timestamp
4. **Updated At** - Last modification timestamp
5. **Send Date & Time** - Scheduled/actual send time
6. **Processed** - Number of leads processed
7. **Delivered** - Successfully delivered messages
8. **Bounce Rate** - Percentage of bounced messages

### ✅ For Email Only (via Mailgun):
9. **Unique Opens** - Number of unique recipients who opened
10. **Total Opens** - Total opens including repeat opens
11. **Unique Clicks** - Number of unique recipients who clicked
12. **Total Clicks** - Total clicks including repeat clicks
13. **Unsubscribed** - Number of unsubscribes
14. **Open Rate** - (Unique Opens / Delivered) × 100
15. **Click Rate** - (Unique Clicks / Delivered) × 100
16. **Click-to-Open Rate** - (Unique Clicks / Unique Opens) × 100

---

## 🔧 Setup Instructions

### **Step 1: Install Required Packages**

```bash
npm install mailgun-js twilio
```

### **Step 2: Add Environment Variables**

Add these to your `.env` file:

```bash
# Mailgun Configuration
MAILGUN_API_KEY=your_mailgun_api_key
MAILGUN_DOMAIN=mg.yourdomain.com
MAILGUN_WEBHOOK_SIGNING_KEY=your_webhook_signing_key
MAILGUN_FROM_EMAIL=noreply@yourdomain.com

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_PHONE=+1234567890

# Base URL for webhooks
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
```

### **Step 3: Configure Mailgun Webhooks**

1. Go to **Mailgun Dashboard** → **Sending** → **Webhooks**
2. Add webhook URL: `https://yourdomain.com/api/webhooks/mailgun`
3. Enable these events:
   - ✅ Delivered
   - ✅ Opened
   - ✅ Clicked
   - ✅ Bounced
   - ✅ Failed
   - ✅ Unsubscribed
   - ✅ Complained
4. Save the **Webhook Signing Key** to your `.env`

### **Step 4: Configure Twilio (No Dashboard Setup Needed)**

Twilio status callbacks are configured per-message when sending. No dashboard setup required!

---

## 📧 Sending Email Campaigns

### **Example: Send Email via Mailgun**

```javascript
const mailgun = require('mailgun-js')({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN
});

async function sendCampaignEmail(campaign, campaignLead, dealer) {
  const emailData = {
    from: `${dealer.name} <${dealer.email}>`,
    to: campaignLead.email,
    subject: campaign.message_content.subject,
    html: campaign.message_content.body, // Send as-is!
    
    // Enable tracking - THIS IS THE KEY!
    'o:tracking': 'yes',           // Enable all tracking
    'o:tracking-clicks': 'yes',    // Auto-wrap links
    'o:tracking-opens': 'yes',     // Auto-add tracking pixel
    
    // Custom variables for webhooks
    'v:campaign_id': campaign._id.toString(),
    'v:campaign_lead_id': campaignLead._id.toString(),
    'v:dealer_id': dealer._id.toString()
  };

  // Send it!
  const result = await mailgun.messages().send(emailData);
  
  // Update your database
  await CampaignLead.findByIdAndUpdate(campaignLead._id, {
    status: 'sent',
    sent_at: new Date(),
    mailgun_message_id: result.id
  });

  await Campaign.findByIdAndUpdate(campaign._id, {
    $inc: { 'stats.sent': 1 }
  });
}
```

**That's it!** Mailgun will:
- ✅ Automatically add tracking pixel for opens
- ✅ Automatically wrap all links for click tracking
- ✅ Send webhooks to your server when events happen
- ✅ Handle unsubscribe links

**No message modification needed!** 🎉

---

## 📱 Sending SMS Campaigns

### **Example: Send SMS via Twilio**

```javascript
const twilio = require('twilio');
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendCampaignSMS(campaign, campaignLead, dealer) {
  const smsData = {
    body: campaign.message_content.body, // Send as-is!
    from: dealer.phone,
    to: campaignLead.phone,
    
    // Status callback - THIS IS THE KEY!
    statusCallback: `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/twilio`
  };

  // Send it!
  const result = await twilioClient.messages.create(smsData);
  
  // Update your database (IMPORTANT: Store message SID!)
  await CampaignLead.findByIdAndUpdate(campaignLead._id, {
    status: 'sent',
    sent_at: new Date(),
    twilio_message_sid: result.sid // Store this for webhook tracking!
  });

  await Campaign.findByIdAndUpdate(campaign._id, {
    $inc: { 'stats.sent': 1 }
  });
}
```

**That's it!** Twilio will:
- ✅ Send webhooks when SMS is delivered/failed
- ✅ Provide detailed error codes for failures
- ✅ Track carrier-level delivery status

**No message modification needed!** 🎉

---

## 🔗 How Webhooks Work

### **Email Journey (Mailgun):**

```
1. You send email → Mailgun
2. Mailgun wraps links + adds tracking pixel (automatic)
3. Mailgun sends email → Recipient
4. Mailgun webhook → "delivered" → Your server updates DB
5. User opens email → Tracking pixel loads
6. Mailgun webhook → "opened" → Your server updates DB
7. User clicks link → Mailgun tracking URL redirects
8. Mailgun webhook → "clicked" → Your server updates DB
```

### **SMS Journey (Twilio):**

```
1. You send SMS → Twilio
2. Twilio sends SMS → Carrier → Recipient
3. Twilio webhook → "sent" → Your server updates DB
4. Carrier confirms delivery
5. Twilio webhook → "delivered" → Your server updates DB
```

---

## 📂 Files Created

### ✅ **Webhook Handlers:**
- `/api/webhooks/mailgun/route.js` - Handles all Mailgun events
- `/api/webhooks/twilio/route.js` - Handles all Twilio events

### ✅ **Worker Example:**
- `/app/worker/campaignWorkerExample.js` - Complete implementation example

### ✅ **Database Models (Already Created):**
- `Campaign` - Enhanced with tracking stats
- `CampaignLead` - Enhanced with engagement fields + SID fields
- `CampaignTracking` - Tracks individual events

### ✅ **Report System (Already Created):**
- `/api/campaigns/[id]/report` - API to fetch report
- `CampaignReportModal` - Frontend component to display report

---

## 🎨 Viewing Reports

1. Go to `/dealer/campaigns`
2. Click the **📊 blue chart icon** next to any campaign
3. View comprehensive metrics in a beautiful modal

### **Report Tabs:**

#### **Overview Tab:**
- Campaign details (status, ID, dates)
- Key metrics (processed, delivered, opens, clicks)
- Rates (delivery, bounce, open, click, unsubscribe)

#### **Engagement Tab (Email):**
- Total vs unique opens
- Total vs unique clicks
- Click-to-open rate
- Event breakdown

#### **Top Links Tab (Email):**
- Most clicked links
- Click counts per link

---

## 🔒 Security Features

### **Mailgun Webhook Verification:**
```javascript
// Automatically verified in /api/webhooks/mailgun/route.js
function verifyMailgunWebhook(signature) {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  const encodedToken = crypto
    .createHmac('sha256', signingKey)
    .update(signature.timestamp + signature.token)
    .digest('hex');
  return encodedToken === signature.signature;
}
```

### **Twilio Webhook Verification:**
```javascript
// Automatically verified in /api/webhooks/twilio/route.js
const isValid = twilio.validateRequest(
  process.env.TWILIO_AUTH_TOKEN,
  twilioSignature,
  webhookUrl,
  params
);
```

---

## 🧪 Testing

### **Test Mailgun Webhook:**
```bash
# Mailgun provides a test event feature in their dashboard
# Or send a real test email to yourself and check logs
```

### **Test Twilio Webhook:**
```bash
# Send a test SMS to your phone number
# Check server logs for webhook events
```

### **Check Webhook Endpoint:**
```bash
# Test that endpoints are active
curl https://yourdomain.com/api/webhooks/twilio
```

---

## 🐛 Debugging

### **Check Mailgun Logs:**
1. Go to **Mailgun Dashboard** → **Sending** → **Logs**
2. Search for your email
3. See all events (delivered, opened, clicked)
4. Check webhook delivery status

### **Check Twilio Logs:**
1. Go to **Twilio Console** → **Monitor** → **Logs** → **Messaging**
2. Find your message by SID
3. See delivery status and errors

### **Check Your Server Logs:**
```bash
# Look for these log messages:
📧 Mailgun Event: opened for Campaign Lead: ...
📱 Twilio SMS Status: delivered for +1234567890
✅ Email delivered to Campaign Lead: ...
```

### **Check Database:**
```javascript
// Check campaign stats
db.campaigns.findOne({ _id: ObjectId("...") })

// Check tracking events
db.campaigntrackings.find({ campaign_id: ObjectId("...") })

// Check lead status
db.campaignleads.find({ campaign_id: ObjectId("...") })
```

---

## 📋 Integration Checklist

### **Before Going Live:**

- [ ] Install `mailgun-js` and `twilio` packages
- [ ] Add all environment variables to `.env`
- [ ] Configure Mailgun webhooks in dashboard
- [ ] Test email sending with tracking enabled
- [ ] Test SMS sending with status callback
- [ ] Verify webhooks are being received (check logs)
- [ ] Test unsubscribe functionality (email)
- [ ] Verify report displays correctly
- [ ] Test with real campaign to yourself first

### **Environment Variables Required:**
```bash
✓ MAILGUN_API_KEY
✓ MAILGUN_DOMAIN
✓ MAILGUN_WEBHOOK_SIGNING_KEY
✓ MAILGUN_FROM_EMAIL
✓ TWILIO_ACCOUNT_SID
✓ TWILIO_AUTH_TOKEN
✓ TWILIO_FROM_PHONE
✓ NEXT_PUBLIC_BASE_URL
```

---

## 🚀 Going to Production

1. **Update your campaign worker** to use the example code
2. **Deploy your application** with new webhook endpoints
3. **Configure Mailgun webhooks** with production URL
4. **Test with a small campaign** (5-10 leads)
5. **Monitor logs** for webhook events
6. **Verify report** shows correct data
7. **Scale up** to larger campaigns

---

## 💡 Key Advantages

### ✅ **No Message Modification:**
- Messages sent exactly as you write them
- No extra tracking URLs visible to users
- Professional appearance

### ✅ **Automatic Tracking:**
- Mailgun handles open/click tracking
- Twilio handles delivery tracking
- No custom code in message content

### ✅ **Reliable:**
- Third-party services handle tracking
- Webhooks have retry logic
- Built-in spam management

### ✅ **Comprehensive:**
- All metrics tracked automatically
- Detailed error reporting
- Easy to debug via provider dashboards

---

## 🎉 You're Done!

Your campaign tracking system is ready! Just:

1. ✅ Use the example code in `campaignWorkerExample.js`
2. ✅ Send messages with tracking flags enabled
3. ✅ Let Mailgun/Twilio handle the rest
4. ✅ View beautiful reports in the UI

**No custom tracking code needed!** 🎯
