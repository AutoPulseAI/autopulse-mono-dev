# System Architecture and Workflow Documentation
## Autopulse.ai - Complete System Flow

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Email Server Setup & Webhook System](#email-server-setup--webhook-system)
3. [Authentication & Access Control](#authentication--access-control)
4. [Lead Management Workflow](#lead-management-workflow)
5. [Communication System](#communication-system)
6. [N8N Integration & AI Response Generation](#n8n-integration--ai-response-generation)
7. [Follow-up System](#follow-up-system)
8. [Support Ticket System](#support-ticket-system)
9. [Calendar & Appointment Management](#calendar--appointment-management)
10. [DealerSocket Integration](#dealersocket-integration)
11. [Complete Workflow Diagram](#complete-workflow-diagram)

---

## 1. System Overview

### Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Email Server (Hestia/Exim4)              │
│              All incoming emails received here               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Webhook Trigger
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Autopulse.ai Backend System                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Admin Module │  │ Dealer Module│  │ N8N Module   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Lead Mgmt    │  │ Communication│  │ Follow-up    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Ticket System│  │ Calendar View │  │ DealerSocket │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Email Server Setup & Webhook System

### 2.1 Email Server Configuration

**Purpose:** Central email server that receives all incoming emails before routing to the system.

**Components:**
- **Email Server:** Hestia/Exim4 or similar mail server
- **Email Accounts:** Configured per dealer
- **Webhook Endpoint:** Receives email notifications

**Setup Process:**

1. **Email Server Installation**
   - Configure mail server (Hestia/Exim4)
   - Set up domain and email accounts
   - Configure SMTP/IMAP settings

2. **Email Account Configuration**
   - Each dealer has one or more email accounts
   - Email format: `{dealer-name}@autopulsemail.com`
   - Accounts stored in `EmailAccount` model

3. **Webhook Configuration**
   - Webhook URL: `/api/webhooks/email`
   - Triggered on incoming email
   - Receives email data (from, to, subject, body, attachments)

**File References:**
- `EMAIL_WEBHOOK_S3_SETUP.md`
- `email_webhook_hestia.sh`
- `email_webhook_simple_with_s3.sh`

### 2.2 Webhook Trigger Flow

```
Incoming Email
    ↓
Email Server (Hestia/Exim4)
    ↓
Webhook Trigger → POST /api/webhooks/email
    ↓
Email Processing Service
    ↓
Identify Dealer (by email account)
    ↓
Lead Creation/Update
```

**Webhook Payload Structure:**
```json
{
  "from": "customer@example.com",
  "to": "dealer@autopulsemail.com",
  "subject": "Inquiry about vehicle",
  "body": "Email content...",
  "attachments": [...],
  "message_id": "...",
  "date": "2026-01-07T..."
}
```

---

## 3. Authentication & Access Control

### 3.1 Admin Module

**Purpose:** Super admin access for system management

**Features:**
- User management (Admin, Agency, Dealer, Vendor, Staff)
- Dealer account management
- Package/subscription management
- System configuration
- Support ticket management
- System-wide analytics
- Cron job controls

**Access Levels:**
- **Super Admin:** Full system access
- **Admin Staff:** Limited admin functions

**Authentication:**
- NextAuth.js authentication
- Role-based access control (RBAC)
- JWT token-based sessions

### 3.2 Dealer Module

**Purpose:** Dealer-specific dashboard and operations

**Features:**
- Dealer dashboard with analytics
- Lead management
- Campaign management
- Conversation management
- Email account setup
- Staff management
- Settings and configuration

**Authentication:**
- Dealer-specific login
- Staff invitation system
- Role-based permissions
- Session management

**Dealer Identification:**
- Each dealer has unique `dealer_id`
- Linked to email accounts
- Associated with DealerSocket credentials

---

## 4. Lead Management Workflow

### 4.1 Lead Creation Process

**Flow:**
```
Incoming Email
    ↓
Webhook Trigger
    ↓
Extract Email Data
    ↓
Identify Dealer (by email account)
    ↓
Check if Lead Exists
    ├─→ Existing Lead: Update communication
    └─→ New Lead: Create lead record
    ↓
Store in Lead Collection
    ↓
Trigger N8N Workflow (if configured)
```

### 4.2 Lead Identification

**Methods:**
1. **By Email Address:** Match `from` email with existing leads
2. **By Phone Number:** Match phone from email signature
3. **By VIN:** Extract VIN from email content
4. **By Name:** Match sender name

**Lead Deduplication:**
- Check email, phone, and VIN
- Merge duplicate leads if found
- Preserve communication history

### 4.3 Lead Status Management

**Status Flow:**
```
New Lead (Lead)
    ↓
Contacted
    ↓
Appointment Booked
    ↓
Managerial Review
    ↓
DND / Converted
```

**Status Updates:**
- Manual updates by dealer staff
- Automatic updates via N8N workflows
- Based on communication patterns
- Based on appointment booking

---

## 5. Communication System

### 5.1 Email Communication

**Incoming Emails:**
- Received via webhook
- Parsed and stored in `Email` collection
- Linked to `Lead` record
- Attachments stored in S3

**Outgoing Emails:**
- Sent via Nodemailer
- SMTP configuration per email account
- Reply threading support
- HTML email support

**Email Processing:**
- Parse .eml files
- Extract attachments
- Store in S3
- Link to conversations

### 5.2 SMS Communication

**Incoming SMS:**
- Received via Twilio webhook
- Processed by SMS worker
- Stored in `Email` collection (unified with emails)
- Linked to `Lead` record

**Outgoing SMS:**
- Sent via Twilio API
- Dealer phone number configuration
- Rate limiting and error handling

### 5.3 Conversation Management

**Unified Inbox:**
- All communications (email + SMS) in one view
- Threaded conversations
- Read/unread status
- Assignment to staff members

**Auto-Reply System:**
- Configurable auto-reply rules
- Per-lead enable/disable
- 5-minute delay before auto-reply
- Cancellation on manual intervention

### 5.4 Campaign Management (Bulk Campaigns)

**Purpose:** Allow dealers to send bulk email/SMS campaigns to targeted segments of leads, with scheduling, templates, and tracking.

**Key Components:**
- **Campaign Module:** UI for creating and managing campaigns
- **Campaign Templates:** Reusable content blocks for emails/SMS
- **Campaign Worker:** Background worker that sends messages (`app/worker/campaignWorker.js`)
- **Cron Service:** Triggers scheduled campaigns (`/api/cron/campaigns`)
- **Lead Targeting:** Select leads by filters, CSV import, or saved segments
- **Stats & Reporting:** Track sends, deliveries, failures, and responses

**Campaign Creation Flow:**
```
Dealer Dashboard → Campaigns
    ↓
Create Campaign
    ├─→ Choose type: Email or SMS
    ├─→ Select template or write content
    ├─→ Attach files (for email)
    ├─→ Select audience (filters/CSV/segment)
    └─→ Choose schedule (now or future)
    ↓
Save Campaign (status: draft → scheduled)
```

**Scheduling & Execution:**
1. **Scheduling (Dealer UI):**
   - Dealer selects date/time in their timezone
   - System converts to UTC and stores:
     - `scheduled_date` (display)
     - `actual_scheduled_date` (for cron/worker)
2. **Cron Trigger:**
   - External or internal cron hits `POST /api/cron/campaigns` every X minutes
   - Finds campaigns with:
     - `status = 'scheduled'`
     - `actual_scheduled_date <= now`
   - Marks campaign as `active`
   - Enqueues one job per lead into Bull/BullMQ queue
3. **Worker Processing (`campaignWorker.js`):**
   - For each queued job:
     - Loads campaign and campaign-lead
     - Sends email via Nodemailer **or** SMS via Twilio
     - Records communication in `Email` collection
     - Updates `CampaignLead` status (sent/failed)
     - Updates `Campaign` stats (sent, failed, total)
   - When all leads are processed, marks campaign as `completed`

**Campaign Data Model (High Level):**
- `Campaign`:
  - `name`, `description`
  - `message_type`: `email` | `sms`
  - `dealer_id`
  - `scheduled_date`, `actual_scheduled_date`
  - `status`: `draft` | `scheduled` | `active` | `completed` | `cancelled`
  - `message_content`: `{ subject, body }`
  - `attachments`: S3 URLs and metadata
  - `stats`: `{ total_leads, sent, delivered, failed }`
- `CampaignLead`:
  - Reference to `Campaign`
  - Reference to `Lead`
  - Per-lead status and error info

**Email & SMS Setup for Campaigns:**
- **Email:**
  - Uses dealer's configured `EmailAccount`
  - Supports HTML content, inline images, and attachments (stored in S3)
  - Reply-to and threading integrated with conversation system
- **SMS:**
  - Uses dealer's Twilio number
  - Content validated for length and encoding
  - Delivery status tracked via Twilio callbacks (where configured)

**Integration with Lead & Conversation System:**
- Every campaign send:
  - Creates an `Email` record (communication log)
  - Links to the `Lead` and `Campaign`
  - Appears in the unified inbox and lead timeline
- Lead status can be influenced by campaign responses via:
  - N8N workflows (e.g., move to `Contacted` on reply)
  - Manual dealer actions

**Monitoring & Analytics:**
- Dashboard cards show:
  - Total SMS / Total Emails sent (including campaigns)
  - Campaign performance via report analytics module
- Admin/reporting APIs:
  - `/api/campaigns` and `/api/campaigns/[id]`
  - `/api/dealers/report-analytics` includes campaign-related metrics

**Operational Requirements:**
- Ensure campaign cron is configured (see `CAMPAIGN_CRON_SETUP.md`):
  - External cron service (cron-job.org, EasyCron, server crontab)
  - Or internal cron service similar to report/reminder cron
- Background worker must be running:
  - `npm run worker` (starts `workers/startWorker.js` which runs `campaignWorker.js` and others)

---

## 6. N8N Integration & AI Response Generation

### 6.1 N8N Setup Module

**Purpose:** Configure N8N workflows for automated lead processing

**Features:**
- Workflow configuration interface
- Trigger setup (email/SMS received)
- AI response generation
- Lead status updates
- Custom business logic

### 6.2 Email/SMS Content Reading

**Process:**
```
Email/SMS Received
    ↓
Extract Content
    ├─→ Subject
    ├─→ Body/Message
    ├─→ Sender Information
    └─→ Context (previous messages)
    ↓
Send to N8N Workflow
    ↓
AI Processing (OpenAI)
    ├─→ Generate Response
    ├─→ Determine Lead Status
    └─→ Extract Intent
    ↓
Return to System
    ↓
Update Lead & Send Response
```

### 6.3 AI Response Generation

**OpenAI Integration:**
- Analyze email/SMS content
- Generate contextual responses
- Determine appropriate lead status
- Extract key information (VIN, vehicle interest, etc.)

**Response Types:**
- **Auto-Reply:** Automated response to customer
- **Status Update:** Change lead status based on content
- **Follow-up Trigger:** Schedule follow-up based on analysis
- **Alert:** Notify staff of important messages

### 6.4 Lead Status Generation

**N8N Workflow Logic:**
- Analyze message content
- Check lead history
- Determine appropriate status:
  - `Lead` - New inquiry
  - `Contacted` - Initial response sent
  - `Appointment Booked` - Customer scheduled
  - `Managerial Review` - Requires attention
  - `DND` - Do not disturb

**Status Update Flow:**
```
N8N Analysis
    ↓
Determine Status
    ↓
Update Lead Record
    ↓
Trigger Follow-up (if needed)
    ↓
Notify Staff (if status = Managerial Review)
```

---

## 7. Follow-up System

### 7.1 Follow-up Settings Module

**Purpose:** Configure automated follow-up sequences

**Features:**
- Create follow-up rules
- Set timing and intervals
- Define message templates
- Configure status-based triggers

**Follow-up Rules:**
- **Time-based:** After X hours/days
- **Status-based:** When lead reaches certain status
- **Event-based:** After appointment, after contact, etc.

### 7.2 Follow-up Execution

**Process:**
```
Follow-up Job Created
    ↓
Scheduled in FollowUpJob Collection
    ↓
Worker Process Checks Jobs
    ↓
Execute Follow-up
    ├─→ Send Email/SMS
    ├─→ Update Lead Status
    └─→ Create Next Follow-up (if sequence)
    ↓
Log Communication
    ↓
Update Job Status
```

**Follow-up Types:**
- **Initial Follow-up:** First contact after lead creation
- **Nurture Sequence:** Multiple follow-ups over time
- **Post-Appointment:** Follow-up after appointment
- **Re-engagement:** Reconnect with inactive leads

### 7.3 Follow-up Job Management

**FollowUpJob Model:**
- `leadId`: Reference to lead
- `scheduledAt`: When to execute
- `status`: pending, completed, cancelled
- `message`: Follow-up content
- `source`: email or sms

**Worker Process:**
- Checks pending jobs every minute
- Executes due follow-ups
- Handles errors and retries
- Updates job status

---

## 8. Support Ticket System

### 8.1 Ticket Creation

**Sources:**
- Manual creation by staff
- Automated from system errors
- Customer inquiries
- Internal requests

**Ticket Categories:**
- Technical Support
- Account Issues
- Feature Requests
- Billing Questions

### 8.2 Ticket Management

**Features:**
- Ticket assignment
- Priority levels
- Status tracking (open, in-progress, resolved, closed)
- Response threading
- Attachment support
- Email notifications

**Ticket Workflow:**
```
Ticket Created
    ↓
Assigned to Staff
    ↓
Status: In Progress
    ↓
Response/Resolution
    ↓
Status: Resolved
    ↓
Status: Closed
```

---

## 9. Calendar & Appointment Management

### 9.1 Calendar View

**Purpose:** Visual calendar interface for appointments

**Features:**
- Monthly/Weekly/Daily views
- Appointment display
- Color coding by status
- Click to view details
- Drag-and-drop rescheduling

### 9.2 Appointment Booking

**Process:**
```
Customer Books Appointment
    ↓
Create Booking Record
    ↓
Send Confirmation (Email/SMS)
    ↓
Schedule Reminders
    ├─→ Pre-appointment reminder
    ├─→ Post-appointment follow-up
    └─→ Managerial review (if needed)
    ↓
Update Lead Status
```

### 9.3 Appointment Reminders

**Reminder Types:**
- **Pre-appointment:** 24 hours before
- **Post-appointment:** After appointment
- **Managerial Review:** For follow-up

**Reminder System:**
- Scheduled in `AppointmentReminder` collection
- Cron job processes reminders
- Sends via email/SMS
- Tracks delivery status

---

## 10. DealerSocket Integration

### 10.1 DealerSocket Connection

**Purpose:** Integrate with DealerSocket CRM system

**Configuration:**
- DealerSocket Dealer ID
- Franchise ID
- API credentials
- Work note settings

**Dealer Account Setup:**
```javascript
dealer_account_information: {
  dealersocket_dealerid: '10362',
  dealersocket_frenchiseid: '1',
  // ... other settings
}
```

### 10.2 Lead Matching Process

**Matching Criteria:**
1. **Dealer ID:** `SiteId` matches `dealersocket_dealerid`
2. **Franchise ID:** `Franchise` matches `dealersocket_frenchiseid`
3. **VIN:** Exact match (if provided)
4. **Email OR Phone:** Match with DealerSocket records

**Matching Flow:**
```
Lead Created/Updated
    ↓
Extract Identifiers
    ├─→ dealer_id
    ├─→ franchise_id
    ├─→ email
    ├─→ phone
    └─→ VIN
    ↓
Search CSVImportedData
    ↓
Find Matching Record
    ↓
Extract EntityId & EventId
    ↓
Insert Work Note
```

### 10.3 Work Note Insertion

**Process:**
```
Match Found in DealerSocket
    ↓
Extract EntityId & EventId
    ↓
Create Work Note Request
    ├─→ Vendor: 'AutoPulse'
    ├─→ DealerId: '10362_1'
    ├─→ EntityId: '1884648'
    ├─→ EventId: '2614974'
    └─→ Note: iframe link to lead
    ↓
Call DealerSocket API
    ↓
Insert Work Note
    ↓
Log Result
```

**Work Note Content:**
- Iframe link to lead details page
- AutoPulse branding
- Clickable link format: `<a href={iframeUrl}>Autopulse</a>`

**Integration Points:**
- Lead creation
- Follow-up execution
- Appointment booking
- Status changes

---

## 11. Complete Workflow Diagram

### 11.1 End-to-End Lead Processing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    INCOMING EMAIL FLOW                          │
└─────────────────────────────────────────────────────────────────┘

1. Email Server (Hestia/Exim4)
   │
   │ Receives: customer@example.com → dealer@autopulsemail.com
   │
   ▼
2. Webhook Trigger
   │ POST /api/webhooks/email
   │
   ▼
3. Email Processing
   │ ├─→ Parse email content
   │ ├─→ Extract attachments → S3
   │ └─→ Identify dealer (by email account)
   │
   ▼
4. Lead Management
   │ ├─→ Check if lead exists (by email/phone)
   │ ├─→ Create new lead OR update existing
   │ └─→ Store in Lead collection
   │
   ▼
5. N8N Workflow Trigger
   │ ├─→ Send email content to N8N
   │ ├─→ AI Analysis (OpenAI)
   │ │   ├─→ Generate response
   │ │   └─→ Determine lead status
   │ └─→ Return results
   │
   ▼
6. Communication Storage
   │ ├─→ Store email in Email collection
   │ ├─→ Link to Lead record
   │ └─→ Update conversation thread
   │
   ▼
7. Lead Status Update
   │ ├─→ Update lead status (from N8N)
   │ └─→ Trigger follow-up (if needed)
   │
   ▼
8. DealerSocket Integration
   │ ├─→ Match lead with DealerSocket records
   │ ├─→ Extract EntityId & EventId
   │ └─→ Insert work note
   │
   ▼
9. Notification & Follow-up
   │ ├─→ Notify dealer staff (if Managerial Review)
   │ ├─→ Schedule follow-up job
   │ └─→ Update dashboard
```

### 11.2 Follow-up Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    FOLLOW-UP EXECUTION FLOW                     │
└─────────────────────────────────────────────────────────────────┘

1. Follow-up Job Scheduled
   │ FollowUpJob collection
   │ scheduledAt: future date/time
   │
   ▼
2. Worker Process
   │ Checks pending jobs every minute
   │
   ▼
3. Execute Follow-up
   │ ├─→ Load lead information
   │ ├─→ Check lead status (skip if DND/Managerial Review)
   │ ├─→ Send email/SMS
   │ └─→ Store communication
   │
   ▼
4. DealerSocket Work Note
   │ ├─→ Match lead
   │ └─→ Insert work note
   │
   ▼
5. Next Follow-up
   │ ├─→ Create next job in sequence (if applicable)
   │ └─→ Update job status: completed
```

### 11.3 Appointment Booking Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    APPOINTMENT BOOKING FLOW                    │
└─────────────────────────────────────────────────────────────────┘

1. Customer Books Appointment
   │ Via booking interface
   │
   ▼
2. Create Booking Record
   │ Booking collection
   │ ├─→ Lead reference
   │ ├─→ Date/time
   │ └─→ Status: confirmed
   │
   ▼
3. Send Confirmation
   │ ├─→ Email confirmation
   │ └─→ SMS confirmation
   │
   ▼
4. Schedule Reminders
   │ AppointmentReminder collection
   │ ├─→ Pre-appointment (24h before)
   │ ├─→ Post-appointment (after)
   │ └─→ Managerial review (if needed)
   │
   ▼
5. Update Lead Status
   │ fe_lead_status: 'Appointment Booked'
   │
   ▼
6. DealerSocket Integration
   │ Insert work note about appointment
```

---

## 12. Module Dependencies

### 12.1 Core Modules

1. **Authentication Module**
   - NextAuth.js
   - User management
   - Role-based access

2. **Email Server Module**
   - Hestia/Exim4 configuration
   - Webhook setup
   - Email parsing

3. **Lead Management Module**
   - Lead CRUD operations
   - Lead identification
   - Status management

4. **Communication Module**
   - Email handling
   - SMS handling
   - Conversation threading

5. **N8N Integration Module**
   - Workflow configuration
   - AI response generation
   - Status determination

6. **Follow-up Module**
   - Job scheduling
   - Execution engine
   - Sequence management

7. **Ticket System Module**
   - Ticket CRUD
   - Assignment
   - Status tracking

8. **Calendar Module**
   - Appointment booking
   - Reminder system
   - Calendar views

9. **DealerSocket Module**
   - Lead matching
   - Work note insertion
   - API integration

### 12.2 Data Models

**Core Models:**
- `User` - Users (Admin, Dealer, Staff)
- `Lead` - Lead records
- `Email` - Communications (email + SMS)
- `EmailAccount` - Dealer email accounts
- `FollowUpJob` - Scheduled follow-ups
- `AppointmentReminder` - Appointment reminders
- `Booking` - Appointment bookings
- `Ticket` - Support tickets
- `CSVImportedData` - DealerSocket imported data

---

## 13. API Endpoints

### 13.1 Webhook Endpoints

- `POST /api/webhooks/email` - Email webhook handler
- `POST /api/webhooks/twilio` - SMS webhook handler

### 13.2 Lead Endpoints

- `GET /api/leads` - List leads
- `POST /api/leads` - Create lead
- `GET /api/leads/[id]` - Get lead details
- `PUT /api/leads/[id]` - Update lead
- `GET /api/leads/stats` - Lead statistics

### 13.3 Communication Endpoints

- `GET /api/conversations` - List conversations
- `POST /api/conversations/reply` - Send reply
- `POST /api/conversations/followup` - Execute follow-up
- `GET /api/conversations/stats` - Communication stats

### 13.4 N8N Integration Endpoints

- `POST /api/n8n/analyze` - Analyze email/SMS content
- `POST /api/n8n/response` - Generate AI response
- `POST /api/n8n/status` - Determine lead status

### 13.5 DealerSocket Endpoints

- `POST /api/dealersocket/match` - Match lead with DealerSocket
- `POST /api/dealersocket/worknote` - Insert work note

---

## 14. Configuration Requirements

### 14.1 Email Server Configuration

**Required Settings:**
- SMTP server address
- IMAP server address
- Email account credentials
- Webhook URL configuration
- Domain settings

### 14.2 N8N Configuration

**Required Settings:**
- N8N server URL
- API credentials
- Workflow IDs
- OpenAI API key
- Response templates

### 14.3 DealerSocket Configuration

**Required Settings:**
- DealerSocket API endpoint
- Public/Private keys
- Dealer ID per dealer account
- Franchise ID per dealer account

### 14.4 Environment Variables

```env
# Email
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASSWORD=

# N8N
N8N_URL=
N8N_API_KEY=

# OpenAI
OPENAI_API_KEY=

# DealerSocket
DEALERSOCKET_PUBLIC_KEY=
DEALERSOCKET_PRIVATE_KEY=
DEALERSOCKET_ENDPOINT=

# AWS S3 (for attachments)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET_NAME=

# Twilio (SMS)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

---

## 15. Error Handling & Logging

### 15.1 Error Handling

**Email Processing Errors:**
- Invalid email format
- Missing dealer identification
- Attachment upload failures
- Webhook processing errors

**N8N Integration Errors:**
- Workflow execution failures
- AI API errors
- Response generation failures

**DealerSocket Errors:**
- Matching failures
- Work note insertion failures
- API authentication errors

### 15.2 Logging

**Log Levels:**
- **INFO:** Normal operations
- **WARN:** Non-critical issues
- **ERROR:** Critical failures

**Logged Events:**
- Email received
- Lead created/updated
- N8N workflow execution
- DealerSocket work note insertion
- Follow-up execution
- Error occurrences

---

## 16. Security Considerations

### 16.1 Authentication

- JWT token-based authentication
- Role-based access control
- Session management
- Password encryption (bcrypt)

### 16.2 Data Security

- Email content encryption
- Secure webhook endpoints
- API key protection
- S3 bucket security

### 16.3 Access Control

- Dealer data isolation
- Staff permission management
- Admin access restrictions
- Audit logging

---

## 17. Performance Optimization

### 17.1 Database Optimization

- Indexed queries
- Efficient aggregation
- Connection pooling
- Query optimization

### 17.2 Caching Strategy

- Redis for session storage
- Queue management (BullMQ)
- API response caching

### 17.3 Background Processing

- Worker processes for heavy tasks
- Queue-based job processing
- Async operations
- Cron job optimization

---

## 18. Monitoring & Maintenance

### 18.1 System Monitoring

- Email processing rate
- Lead creation rate
- N8N workflow success rate
- DealerSocket integration status
- Error rates

### 18.2 Maintenance Tasks

- Database cleanup
- Log rotation
- Queue monitoring
- S3 storage management
- Performance tuning

---

## 19. Future Enhancements

### 19.1 Planned Features

- Advanced AI capabilities
- Multi-language support
- Enhanced analytics
- Mobile app integration
- Additional CRM integrations

### 19.2 Scalability Improvements

- Load balancing
- Database sharding
- Microservices architecture
- CDN integration

---

## 20. Documentation References

### Related Documents

- `Statement_of_Work.md` - Complete project SOW
- `DEALERSOCKET_WORKNOTE_MATCHING_FLOW.md` - DealerSocket integration details
- `EMAIL_WEBHOOK_S3_SETUP.md` - Email webhook setup
- `CAMPAIGN_CRON_SETUP.md` - Campaign system setup
- `APPOINTMENT_REMINDER_CRON_SERVICE.md` - Reminder system

---

## 📅 Date: January 7, 2026

## Status: ✅ DOCUMENTED

Complete system architecture and workflow documentation created.

---

## Summary

This document provides a comprehensive overview of the Autopulse.ai system architecture, covering:

1. ✅ **Email Server Setup** - Central email server with webhook triggers
2. ✅ **Authentication System** - Admin and Dealer modules with RBAC
3. ✅ **Lead Management** - Complete lead creation and identification workflow
4. ✅ **Communication System** - Unified email and SMS handling
5. ✅ **N8N Integration** - AI-powered response generation and status determination
6. ✅ **Follow-up System** - Automated follow-up sequences
7. ✅ **Support Tickets** - Internal support system
8. ✅ **Calendar & Appointments** - Booking and reminder system
9. ✅ **DealerSocket Integration** - CRM integration with work note insertion

All components work together to provide a complete lead management and communication automation system.

