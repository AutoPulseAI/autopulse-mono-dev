# Auto-Reply Control System - Design Document

## Current System Analysis

### Overview
The system currently has:
1. **SMS Worker** (`app/worker/processSms.js`) - Processes incoming SMS messages
2. **Email Worker** (`app/worker/emailWorker.js`) - Processes incoming emails  
3. **Manual Reply API** (`app/api/conversations/reply/route.js`) - Allows admin users to manually reply
4. **Lead Model** (`app/models/Lead.js`) - Stores lead information
5. **Email Model** (`app/models/Email.js`) - Stores all conversations (SMS/Email)

### Current Auto-Reply Behavior
- Auto-reply triggers **immediately** when a message is received
- Only checks dealer-level setting: `dealer.setting.autoReplyEnabled`
- No per-lead control
- No delay mechanism
- No awareness of manual admin intervention

---

## Problem Statement

**Requirements:**
1. ✅ Enable/disable auto-reply for **specific leads** (not just dealer-wide)
2. ✅ Implement a **5-minute waiting period** before sending auto-reply
3. ✅ **Cancel auto-reply** if admin manually replies within the 5-minute window
4. ✅ Track manual intervention to prevent future auto-replies during active admin engagement

---

## Proposed Solution Architecture

### 1. Database Schema Changes

#### 1.1 Lead Model Updates
Add fields to `Lead` model to control auto-reply behavior:

```javascript
{
  // New fields for auto-reply control
  auto_reply_enabled: { 
    type: Boolean, 
    default: true  // Inherit from dealer setting initially
  },
  
  auto_reply_paused_until: { 
    type: Date, 
    default: null  // When set, auto-reply is paused until this time
  },
  
  last_manual_reply_at: { 
    type: Date, 
    default: null  // Track when admin last manually replied
  },
  
  last_manual_reply_by: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    default: null  // Which admin user last replied manually
  }
}
```

**Field Explanations:**
- `auto_reply_enabled`: Master switch for this lead (can be toggled by admin UI)
- `auto_reply_paused_until`: Temporary pause (e.g., set to 30 mins after manual reply)
- `last_manual_reply_at`: Helps track admin engagement patterns
- `last_manual_reply_by`: Attribution for manual replies

#### 1.2 Pending Auto-Reply Queue
Create a new collection to manage delayed auto-replies:

```javascript
// app/models/PendingAutoReply.js
{
  lead_id: { type: ObjectId, ref: 'Lead', required: true, index: true },
  incoming_message_id: { type: String, required: true, index: true },
  scheduled_send_at: { type: Date, required: true, index: true },
  
  status: { 
    type: String, 
    enum: ['pending', 'sent', 'cancelled', 'failed'],
    default: 'pending',
    index: true
  },
  
  // Store the prepared response
  response_content: { type: String },
  response_mode: { type: String, enum: ['sms', 'email'] },
  recipient: { type: String },
  sender: { type: String },
  subject: { type: String },
  
  // Metadata
  dealer_id: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  sent_at: { type: Date },
  cancelled_at: { type: Date },
  cancelled_by: { type: ObjectId, ref: 'User' },
  cancellation_reason: { type: String },
  
  // Reference to AI response
  ai_response_data: { type: mongoose.Schema.Types.Mixed }
}
```

**Index Strategy:**
```javascript
// Compound index for efficient queries
{ lead_id: 1, status: 1, scheduled_send_at: 1 }
```

---

### 2. Workflow Design

#### 2.1 Incoming Message Flow (SMS/Email Workers)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Message Arrives (SMS or Email)                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Process Message (AI Analysis, Lead Detection, etc.)      │
│    - Create/Update Lead                                      │
│    - Store incoming message in Email collection             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Check Auto-Reply Eligibility                             │
│    ❌ Skip if:                                               │
│       - Dealer auto-reply disabled                           │
│       - Lead auto_reply_enabled = false                      │
│       - Lead auto_reply_paused_until > now                   │
│       - Status = "Managerial Review"                         │
│    ✅ Continue if all checks pass                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Create Pending Auto-Reply Record                         │
│    - scheduled_send_at = now + 5 minutes                    │
│    - status = 'pending'                                     │
│    - Store AI-generated response content                    │
│    - Store all necessary metadata                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Return (Don't send immediately)                          │
│    Note: Background job will handle sending                 │
└─────────────────────────────────────────────────────────────┘
```

**Key Changes:**
- Remove immediate `sendEmail()` / `sendSMS()` calls
- Instead, save to `PendingAutoReply` collection
- Set `scheduled_send_at` to `Date.now() + 5 minutes`

#### 2.2 Manual Reply Flow (API Route)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Admin Sends Manual Reply via UI                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Authenticate User & Send Message                         │
│    - Verify JWT token                                        │
│    - Send SMS/Email immediately                              │
│    - Save to Email collection (message_by = admin user ID)  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Cancel Pending Auto-Replies for This Lead                │
│    - Find all pending auto-replies for this lead_id         │
│    - Update status = 'cancelled'                             │
│    - Set cancelled_by = current admin user                   │
│    - Set cancellation_reason = 'manual_reply'                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Update Lead Record                                        │
│    - last_manual_reply_at = now                              │
│    - last_manual_reply_by = current admin user ID            │
│    - auto_reply_paused_until = now + 30 minutes (optional)  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Return Success Response                                   │
└─────────────────────────────────────────────────────────────┘
```

**Key Changes to Manual Reply API:**
- After sending manual reply, cancel all pending auto-replies for that lead
- Update lead's manual reply metadata
- Optionally pause auto-reply for 30 minutes (configurable)

#### 2.3 Auto-Reply Scheduler (New Background Job)

```
┌─────────────────────────────────────────────────────────────┐
│ Cron Job (Runs Every Minute)                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Query Pending Auto-Replies                               │
│    WHERE:                                                    │
│      - status = 'pending'                                    │
│      - scheduled_send_at <= now                              │
│    LIMIT: 100 (batch processing)                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. For Each Pending Auto-Reply:                             │
│    a) Double-check lead eligibility                          │
│       - Verify auto_reply_enabled still true                 │
│       - Check auto_reply_paused_until                        │
│    b) Check for recent manual replies                        │
│       - Query Email collection for manual replies            │
│       - If found after this pending reply created → cancel   │
│    c) Send the message                                       │
│       - Call sendEmail() or sendSMS()                        │
│       - Save sent message to Email collection                │
│    d) Update pending record                                  │
│       - status = 'sent' (or 'failed')                        │
│       - sent_at = now                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Log Results & Cleanup                                     │
│    - Log success/failure counts                              │
│    - Optional: Archive old records (older than 30 days)      │
└─────────────────────────────────────────────────────────────┘
```

**Implementation Options:**
1. **Node Cron** (runs in same process)
2. **Bull Queue** (recommended - already used for email/SMS processing)
3. **Separate scheduler service**

**Recommended:** Use Bull Queue with a recurring job that checks every minute.

---

### 3. Edge Cases & Considerations

#### 3.1 Race Conditions
**Problem:** Manual reply sent at same time as scheduled auto-reply

**Solution:**
- Use database transactions or atomic operations
- Check for manual replies in the last 5 minutes before sending auto-reply
- Add mutex/lock on lead_id during send operation

#### 3.2 Multiple Messages in Quick Succession
**Problem:** Customer sends 3 messages within 5 minutes

**Scenarios:**
1. **Option A - One Auto-Reply Per Conversation:**
   - Only create pending auto-reply for first message
   - Cancel it if subsequent messages arrive
   - Create new pending auto-reply for latest message

2. **Option B - Reply to Each Message:**
   - Create pending auto-reply for each message
   - Track separately
   - Cancel all if manual reply occurs

**Recommendation:** Option A - simpler and less spammy

#### 3.3 Admin "Taking Over" Conversation
**Problem:** How long should auto-reply stay paused after manual reply?

**Options:**
1. **Fixed Duration (30 minutes)** - Simple, predictable
2. **Until No Activity (2 hours)** - More intelligent
3. **Manual Re-enable** - Admin must explicitly turn back on
4. **Smart Detection** - Pause until conversation goes cold (no messages for X hours)

**Recommendation:** Combination approach:
- Pause for 30 minutes after manual reply (prevents immediate auto-replies)
- If admin replies again within 2 hours, extend pause
- After 2 hours of no admin activity, auto-resume

#### 3.4 Dealer vs Lead Settings Priority
**Problem:** What if dealer disables auto-reply but lead has it enabled?

**Priority Chain (top to bottom):**
1. Dealer-level `autoReplyEnabled = false` → No auto-reply for any lead
2. Lead-level `auto_reply_enabled = false` → No auto-reply for this lead
3. Lead-level `auto_reply_paused_until > now` → Temporarily paused
4. Status = "Managerial Review" or "DND" → No auto-reply

#### 3.5 What Happens to Pending Replies When Lead Updated?
**Scenarios:**
- Lead status changed to "Managerial Review" → Cancel pending auto-replies
- Lead marked as "DND" → Cancel pending auto-replies
- Lead assigned to different admin → Keep pending auto-replies (unless admin replies)

---

### 4. User Interface Considerations

#### 4.1 Lead Detail Page
**New UI Elements:**
```
┌──────────────────────────────────────────────────────┐
│ Lead: John Doe                                       │
├──────────────────────────────────────────────────────┤
│                                                      │
│ Auto-Reply Settings:                                 │
│   [✓] Enable auto-reply for this lead               │
│                                                      │
│   Status: ⏸️  Paused until 2:30 PM                   │
│          (Manual reply by Admin User at 2:00 PM)    │
│                                                      │
│   [Resume Now]  [Pause for 1 hour]                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 4.2 Conversation Thread UI
**Visual Indicators:**
```
┌──────────────────────────────────────────────────────┐
│ Conversation with John Doe                           │
├──────────────────────────────────────────────────────┤
│                                                      │
│ 2:00 PM - John Doe (Customer)                       │
│ "Can I schedule a test drive?"                      │
│                                                      │
│ ⏱️  Auto-reply scheduled for 2:05 PM                 │
│     [Send Now] [Cancel] [View Draft]                │
│                                                      │
│ ─────────────────────────────────────────────────   │
│                                                      │
│ [Type your reply...]                                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 4.3 Bulk Lead Management
```
┌──────────────────────────────────────────────────────┐
│ Leads Dashboard                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│ [Select All] | Bulk Actions: ▼                      │
│   • Enable Auto-Reply                                │
│   • Disable Auto-Reply                               │
│   • Pause Auto-Reply for 1 hour                      │
│                                                      │
│ ☑️  John Doe        | Auto-reply: ✅ Enabled          │
│ ☑️  Jane Smith      | Auto-reply: ⏸️  Paused          │
│ □  Bob Johnson     | Auto-reply: ❌ Disabled         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### 5. Configuration Options

#### 5.1 Environment Variables
```bash
# Auto-reply delay (in milliseconds)
AUTO_REPLY_DELAY_MS=300000  # 5 minutes default

# How long to pause after manual reply (in milliseconds)
AUTO_REPLY_PAUSE_AFTER_MANUAL_MS=1800000  # 30 minutes default

# Conversation "cold" threshold (resume auto-reply)
AUTO_REPLY_RESUME_AFTER_INACTIVE_MS=7200000  # 2 hours default

# Scheduler interval (how often to check for pending replies)
AUTO_REPLY_SCHEDULER_INTERVAL_MS=60000  # 1 minute default

# Batch size for processing
AUTO_REPLY_BATCH_SIZE=100
```

#### 5.2 Dealer-Level Settings (Optional)
Allow each dealer to customize:
```javascript
{
  dealer_id: "123",
  auto_reply_settings: {
    enabled: true,
    delay_minutes: 5,
    pause_after_manual_minutes: 30,
    resume_after_inactive_hours: 2,
    reply_to_each_message: false,  // or only first in burst
    business_hours_only: false,
    business_hours: {
      timezone: "America/New_York",
      schedule: {
        monday: { start: "09:00", end: "17:00" },
        // ... other days
      }
    }
  }
}
```

---

### 6. Monitoring & Analytics

#### 6.1 Metrics to Track
```javascript
{
  // Auto-reply performance
  total_auto_replies_scheduled: Number,
  total_auto_replies_sent: Number,
  total_auto_replies_cancelled: Number,
  total_auto_replies_failed: Number,
  
  // Manual intervention
  total_manual_replies: Number,
  auto_replies_prevented_by_manual: Number,
  average_response_time_manual: Number,  // in seconds
  average_response_time_auto: Number,
  
  // Lead-level stats
  leads_with_auto_reply_disabled: Number,
  leads_with_auto_reply_paused: Number,
  
  // Time-based
  period: { start: Date, end: Date },
  dealer_id: String
}
```

#### 6.2 Logging Strategy
```javascript
// Critical events to log
{
  event: 'auto_reply_scheduled',
  lead_id: '...',
  scheduled_at: Date,
  incoming_message_id: '...'
}

{
  event: 'auto_reply_cancelled',
  lead_id: '...',
  reason: 'manual_reply',
  cancelled_by: 'user_id',
  pending_reply_id: '...'
}

{
  event: 'auto_reply_sent',
  lead_id: '...',
  message_id: '...',
  delay_actual_ms: 305234,  // actual delay vs scheduled
}
```

---

### 7. Testing Scenarios

#### Test Case 1: Normal Auto-Reply Flow
```
1. Customer sends SMS at 2:00 PM
2. Auto-reply scheduled for 2:05 PM
3. No manual intervention
4. ✅ Auto-reply sent at 2:05 PM
```

#### Test Case 2: Manual Reply Cancels Auto-Reply
```
1. Customer sends SMS at 2:00 PM
2. Auto-reply scheduled for 2:05 PM
3. Admin manually replies at 2:02 PM
4. ✅ Auto-reply cancelled, not sent
5. ✅ Lead auto_reply_paused_until set to 2:32 PM
```

#### Test Case 3: Lead Auto-Reply Disabled
```
1. Lead has auto_reply_enabled = false
2. Customer sends SMS at 2:00 PM
3. ✅ No auto-reply scheduled
4. ✅ Admin must reply manually
```

#### Test Case 4: Multiple Messages in Burst
```
1. Customer sends SMS #1 at 2:00 PM
2. Auto-reply scheduled for 2:05 PM
3. Customer sends SMS #2 at 2:02 PM
4. ✅ First auto-reply cancelled
5. ✅ New auto-reply scheduled for 2:07 PM (2:02 + 5 min)
```

#### Test Case 5: Pause Duration Respected
```
1. Manual reply sent at 2:00 PM
2. auto_reply_paused_until set to 2:30 PM
3. Customer sends new message at 2:15 PM
4. ✅ No auto-reply scheduled (still paused)
5. Customer sends new message at 2:35 PM
6. ✅ Auto-reply scheduled for 2:40 PM (pause expired)
```

#### Test Case 6: Dealer-Wide Disable Overrides
```
1. Lead has auto_reply_enabled = true
2. Dealer has autoReplyEnabled = false
3. Customer sends message
4. ✅ No auto-reply scheduled (dealer setting takes precedence)
```

---

### 8. Implementation Phases

#### Phase 1: Core Functionality (MVP)
- ✅ Add fields to Lead model
- ✅ Create PendingAutoReply model
- ✅ Modify SMS/Email workers to create pending replies
- ✅ Create scheduler background job
- ✅ Modify manual reply API to cancel pending replies
- ✅ Basic testing

**Estimated Time:** 3-4 days

#### Phase 2: UI Integration
- ✅ Lead detail page auto-reply toggle
- ✅ Conversation thread pending reply indicator
- ✅ Admin notifications for pending replies
- ✅ Bulk actions for lead management

**Estimated Time:** 2-3 days

#### Phase 3: Advanced Features
- ✅ Smart pause duration logic
- ✅ Business hours restrictions
- ✅ Per-dealer customization
- ✅ Analytics dashboard

**Estimated Time:** 3-5 days

#### Phase 4: Polish & Optimization
- ✅ Performance optimization
- ✅ Comprehensive logging
- ✅ Error handling improvements
- ✅ Documentation

**Estimated Time:** 2-3 days

**Total Estimated Time:** 10-15 days

---

### 9. Migration Strategy

#### Step 1: Deploy Database Changes
```javascript
// Migration script
async function addAutoReplyFields() {
  // Add default values to existing leads
  await Lead.updateMany(
    { auto_reply_enabled: { $exists: false } },
    { 
      $set: { 
        auto_reply_enabled: true,
        auto_reply_paused_until: null,
        last_manual_reply_at: null,
        last_manual_reply_by: null
      } 
    }
  );
}
```

#### Step 2: Deploy Code Changes (Feature Flag)
```javascript
// Environment variable to control rollout
const AUTO_REPLY_DELAY_ENABLED = process.env.AUTO_REPLY_DELAY_ENABLED === 'true';

if (AUTO_REPLY_DELAY_ENABLED) {
  // Use new pending auto-reply logic
} else {
  // Use old immediate auto-reply logic
}
```

#### Step 3: Gradual Rollout
1. Enable for internal testing dealer (1-2 days)
2. Enable for pilot dealer (3-7 days)
3. Enable for 10% of dealers (1 week)
4. Enable for all dealers
5. Remove feature flag & old code

---

### 10. Rollback Plan

**If Issues Arise:**

1. **Immediate:** Set `AUTO_REPLY_DELAY_ENABLED=false` in environment
   - Falls back to old immediate auto-reply behavior
   - No database changes needed

2. **Clean Up Pending Replies:**
```javascript
// Cancel all pending auto-replies
await PendingAutoReply.updateMany(
  { status: 'pending' },
  { 
    status: 'cancelled',
    cancellation_reason: 'system_rollback'
  }
);
```

3. **Optional:** Remove new fields from Lead model in future release

---

## Summary

### Key Benefits
✅ **Better User Experience:** 5-minute buffer allows humans to respond first  
✅ **Prevents Conflicts:** No duplicate auto + manual replies  
✅ **Granular Control:** Per-lead and per-dealer settings  
✅ **Intelligent Pausing:** System learns when admins are actively engaging  
✅ **Audit Trail:** Track all auto-reply decisions and cancellations  
✅ **Scalable:** Queue-based architecture handles high volume  

### Potential Concerns
⚠️ **Increased Complexity:** More moving parts to maintain  
⚠️ **Delayed First Response:** 5-minute wait could feel slow (mitigated by manual override)  
⚠️ **Storage Growth:** PendingAutoReply collection will grow (mitigated by archiving)  

### Next Steps
1. **Review & Approve Design:** Get stakeholder sign-off
2. **Refine Requirements:** Finalize business rules (pause duration, etc.)
3. **Create Technical Spec:** Detailed code-level implementation plan
4. **Begin Phase 1 Development:** Start with MVP features

---

## Questions for Discussion

1. **Delay Duration:** Is 5 minutes the right delay? Should it be configurable per dealer?

2. **Pause Strategy:** After manual reply, how long should auto-reply be paused?
   - Fixed 30 minutes?
   - Until conversation goes cold (2 hours)?
   - Manual re-enable only?

3. **Multiple Messages:** Should we reply to every customer message or only the first in a burst?

4. **Business Hours:** Should auto-reply respect business hours? Or send 24/7?

5. **Notification:** Should admins get notified about pending auto-replies? (e.g., "Auto-reply will send in 3 minutes")

6. **Override:** Should admins be able to manually trigger auto-reply immediately? Or edit the scheduled response?

7. **Metrics:** What KPIs matter most? Response time? Manual intervention rate? Customer satisfaction?

8. **Failure Handling:** What if sending fails after 5 minutes? Retry? Alert admin?

---

**Document Version:** 1.0  
**Last Updated:** December 12, 2025  
**Author:** System Design Team  
**Status:** Draft - Awaiting Review
