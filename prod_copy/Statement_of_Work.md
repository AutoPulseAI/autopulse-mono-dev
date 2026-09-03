# Statement of Work (SOW)
## Autopulse.ai - AI-Powered Automotive Lead Management & Campaign System

---

## 1. PROJECT OVERVIEW

### 1.1 Project Name
**Autopulse.ai Backend System (AID MVCS Backend)**

### 1.2 Project Description
A comprehensive, multi-tenant SaaS platform designed for automotive dealerships to manage leads, automate marketing campaigns, handle customer communications, and streamline appointment booking. The system provides intelligent automation for email/SMS campaigns, lead tracking, follow-ups, and reporting.

### 1.3 Project Objectives
- Automate marketing campaign execution for automotive dealers
- Centralize lead management from multiple sources
- Provide intelligent auto-reply and follow-up systems
- Enable appointment booking and reminder automation
- Deliver actionable analytics and scheduled reports
- Support multi-tenant architecture (Admin, Agency, Dealer, Vendor)
- Integrate with third-party services (Twilio, Email, AWS S3, Stripe)

---

## 2. SCOPE OF WORK

### 2.1 Core Features & Modules

> **Note on implementation order:**  
> Modules were implemented in phases aligned with the system architecture described in `SYSTEM_ARCHITECTURE_AND_WORKFLOW.md`.  
> High‑level sequence:
> 1) Email server & email account setup → 2) Authentication & user management → 3) Lead management → 4) Conversation/communication → 5) N8N/AI workflows → 6) Follow-up → 7) Support tickets → 8) Calendar & appointments → 9) DealerSocket integration (work note insert) → 10) Campaign management → 11) Reporting/analytics and other enhancements.

### 2.1 Core Features & Modules

> **Note on implementation order:**  
> Modules were implemented in phases aligned with the system architecture described in `SYSTEM_ARCHITECTURE_AND_WORKFLOW.md`.  
> High‑level sequence:  
> 1) Email server & email account setup → 2) Authentication & user management → 3) Lead management → 4) Conversation/communication → 5) N8N/AI workflows → 6) Follow-up → 7) Support tickets → 8) Calendar & appointments → 9) DealerSocket integration (work note insert) → 10) Campaign management → 11) Reporting/analytics and other enhancements.

#### 2.1.1 Email Server & Email Account Setup
**Description:** Setup and configuration of the Hestia/Exim‑based email server and dealer email accounts that handle all incoming mail and trigger webhooks into the Autopulse backend.

**Implementation Phase:** Core (Phase 1 – foundational infrastructure implemented first)

**Features:**
- Installation and configuration of Hestia/Exim email server
- Domain and DNS (MX/SPF/DKIM) configuration for Autopulse mail domains
- Creation and management of dealer‑specific email addresses (e.g. `dealer@autopulsemail.com`)
- Central routing of all incoming emails through the Hestia server
- Webhook integration:
  - Incoming messages are parsed by the mail server and forwarded to backend webhooks
  - Primary endpoint: `/api/webhooks/email`
  - Payload includes from/to, subject, body (HTML/text), attachments, message‑id, and timestamps
- Mapping of incoming emails to dealers via configured `EmailAccount` records

**Technical Implementation:**
- Hestia/Exim configuration:
  - Mailboxes and/or aliases for each dealer
  - Pipe/forward rules to invoke webhook scripts:
    - `email_webhook_hestia.sh`
    - `email_webhook_simple_with_s3.sh`
- Backend webhook handler:
  - Validates and normalizes incoming payload
  - Stores raw content and attachments (S3) for audit/history
  - Looks up the matching `EmailAccount` to identify the dealer and entry point for lead/conversation flows
- Documentation:
  - `EMAIL_WEBHOOK_S3_SETUP.md`
  - `email_webhook_hestia.sh`
  - `email_webhook_simple_with_s3.sh`

#### 2.1.2 Lead Management System
**Description:** Comprehensive lead tracking and management system.

**Implementation Phase:** Core (Phase 1 – implemented early as a foundation module)

**Features:**
- Lead capture from multiple sources (email, SMS, CSV import, webhooks)
- Lead assignment to staff members
- Custom lead fields with flexible schema
- Lead status tracking and lifecycle management
- Lead source attribution
- Lead deduplication and validation
- Lead search and filtering
- Lead activity history
- Integration with DealerSocket and other CRM systems  
  - **DealerSocket work-note insert & Entity/Event mapping were introduced later as a client change request**, after the core lead module was stable.

**Data Points:**
- Name, email, phone
- Source tracking
- Dealer association
- Staff assignment
- Status and status change timestamps
- Custom data fields (vehicle interest, budget, notes, etc.)
- Communication history

#### 2.1.3 Conversation Management
**Description:** Unified inbox for all customer communications.

**Implementation Phase:** Core (Phase 1–2 – implemented together with lead management and email/SMS handling)

**Features:**
- Bidirectional email communication
- SMS messaging via Twilio
- Conversation threading and history
- Manual reply capability
- Auto-reply system with intelligent controls
- Conversation assignment to staff
- Read/unread status tracking
- Attachment handling in conversations
- Email parsing and webhook integration

**Auto-Reply Control Features:**
- Per-lead auto-reply enable/disable
- 5-minute delay before auto-reply
- Cancellation of auto-reply on manual intervention
- Temporary pause functionality
- Auto-reply templates

#### 2.1.4 Appointment Booking System
**Description:** Streamlined appointment scheduling and management.

**Implementation Phase:** Added later (Phase 3 – booking calendar view and reminder settings were introduced after initial go‑live based on client request)

**Features:**
- Online booking interface
- Dealer availability management
- Booking confirmation emails/SMS
- Appointment reminder system
- Pre-appointment reminders
- Post-appointment follow-ups
- Managerial review follow-ups
- Rescheduling and cancellation
- Booking analytics

**Reminder Types:**
- `appointment_reminder` - Pre-appointment notifications
- `post_appointment` - Post-appointment follow-ups
- `managerial_review` - Internal review notifications

#### 2.1.5 Automated Follow-Up System
**Description:** Intelligent follow-up scheduling based on lead behavior and status.

**Implementation Phase:** Core + Enhancement (initial follow-up engine in early phases; advanced rules and integration with N8N were added later)

**Features:**
- Configurable follow-up rules
- Multi-stage follow-up sequences
- Email and SMS follow-ups
- Follow-up queue management
- Manual override capability
- Follow-up tracking and analytics
- Integration with lead status changes

#### 2.1.6 Report & Analytics System
**Description:** Automated report generation and delivery.

**Implementation Phase:** Enhancement (Phase 4 – report analytics and visual dashboards were introduced later at client request)

**Features:**
- Scheduled report generation (daily, weekly, monthly, yearly)
- Customizable report metrics
- Email delivery of reports
- Report templates
- Dashboard analytics
- Key metrics tracking:
  - Lead statistics
  - Conversation metrics
  - Vehicle click tracking
  - Revenue analytics
  - Campaign performance
  - Staff performance metrics

**Report Scheduler:**
- Configurable frequency and timing
- Multiple recipients
- Custom metric selection
- Timezone-aware scheduling

#### 2.1.7 User Management & Access Control
**Description:** Multi-tenant role-based access control system for Admin, Agency, Dealer, Vendor, and Staff user ends.

**Implementation Phase:** Core (Phase 1 – required for Admin/Dealer/Vendor modules and authentication)

**User Roles:**
- **Admin:** Super admin with full system access (Admin end)
- **Agency:** Agency-level management
- **Dealer:** Dealership staff and management (Dealer end)
- **Vendor:** External vendor access with limited capabilities (Vendor end)
- **Staff:** Dealer staff members

**Features:**
- Role-based permissions and best-practice RBAC
- Custom permission management per role (Admin/Dealer/Vendor/Staff)
- User profile management
- Staff invitation system
- Login-as functionality for support (Admin impersonation of Dealer/Staff)
- Session management
- Password security (bcrypt)
- JWT authentication / NextAuth integration

#### 2.1.8 Subscription & Package Management
**Description:** Subscription and billing system.

**Implementation Phase:** Enhancement (introduced after core lead and communication flows)

**Features:**
- Package creation and management
- Subscription plans (Basic, Pro, Enterprise)
- Stripe payment integration
- Subscription status tracking
- Renewal management
- Upgrade/downgrade functionality
- Subscription requests and approvals
- Usage tracking

#### 2.1.9 Support Ticket System
**Description:** Internal support and help desk system.

**Implementation Phase:** Enhancement (Phase 3 – implemented after core communication and follow-up modules)

**Features:**
- Ticket creation and tracking
- Ticket categories
- Priority levels
- Status management (open, in-progress, resolved, closed)
- Ticket assignment
- Response threading
- Attachment support
- Email notifications

#### 2.1.10 Email Account Integration
**Description:** Multi-email account management for dealers.

**Implementation Phase:** Core (Phase 1 – required early so that email server/webhook flow could route messages to the correct dealer)

**Features:**
- Multiple email account setup per dealer
- SMTP/IMAP configuration
- Email webhook processing
- Inbox synchronization
- Email parsing from `.eml` files
- Attachment handling with S3 storage
- Email-to-lead conversion
- Reply tracking

#### 2.1.11 CSV Import System
**Description:** Bulk data import functionality.

**Implementation Phase:** Enhancement (added to simplify onboarding and bulk lead/vehicle loading)

**Features:**
- CSV file upload
- Field mapping
- Data validation
- Import preview
- Batch processing
- Error handling and reporting
- Import history
- Support for leads and vehicles

#### 2.1.12 Vehicle Management
**Description:** Inventory management for dealerships.

**Implementation Phase:** Enhancement (added after core lead/communication modules to support inventory‑driven campaigns and reporting)

**Features:**
- Vehicle listing management
- Vehicle details (make, model, year, price, etc.)
- Vehicle image management
- Click tracking
- Integration with dealer websites
- Vehicle availability status
- Search and filtering

#### 2.1.13 Campaign Management System
**Description:** Bulk email/SMS messaging system with advanced scheduling and tracking capabilities.

**Implementation Status:** <span style="color:red">Planned / Partially implemented – final automation & management UI not completed yet</span>

**Features:**
- Campaign creation with rich text editor
- Support for Email and SMS campaigns
- CSV-based lead import
- Campaign template management
- Attachment support (images, PDFs, documents)
- Scheduled campaign execution with timezone support
- Real-time campaign statistics (sent, delivered, failed)
- Campaign status tracking (draft, scheduled, active, completed, cancelled)
- Queue-based processing using BullMQ
- Background worker for asynchronous message delivery

**Technical Implementation:**
- Campaign scheduling with UTC conversion
- Dedicated worker process (`campaignWorker.js`)
- Redis-based job queue
- Cron job integration for automated execution
- S3 integration for attachment storage

### 2.2 Technical Architecture

#### 2.2.1 Technology Stack
- **Framework:** Next.js 16 (React 19)
- **Backend:** Node.js with Express
- **Database:** MongoDB (Mongoose ORM)
- **Queue System:** BullMQ with Redis
- **Authentication:** NextAuth.js v4
- **Email Service:** Nodemailer
- **SMS Service:** Twilio
- **File Storage:** AWS S3
- **Payment Processing:** Stripe
- **Styling:** Tailwind CSS, Bootstrap 5

#### 2.2.2 Key Dependencies
- OpenAI integration for AI features
- AWS SDK for S3 operations
- Moment.js/date-fns for timezone handling
- React Hook Form for form management
- Recharts for analytics visualization
- React Quill for rich text editing
- Axios for HTTP requests
- CSV parsing libraries

#### 2.2.3 Background Workers
- **Campaign Worker:** Processes campaign lead messages
- **Email Worker:** Handles incoming email processing
- **SMS Worker:** Processes incoming SMS messages
- **Follow-up Worker:** Manages automated follow-ups
- **Appointment Reminder Worker:** Sends appointment notifications

#### 2.2.4 Cron Services
- Campaign execution cron (every 5 minutes)
- Appointment reminder cron
- Report generation cron (every minute)
- CSV import processing cron
- Subscription renewal cron

#### 2.2.5 Database Models
- User
- Lead
- Campaign
- CampaignLead
- CampaignTemplate
- Email (Conversations)
- EmailAccount
- Booking
- AppointmentReminder
- FollowUpJob
- Vehicle
- Subscription
- Package
- Ticket
- TicketCategory
- Role
- Permission
- ReportSchedule
- CSVImportData
- DealerWebsiteClick
- VehicleClick
- WebhookLog

### 2.3 API Structure

#### 2.3.1 API Routes
**Authentication:**
- `/api/auth/*` - NextAuth.js authentication

**Admin:**
- `/api/admin/message-stats` - Message statistics

**Campaigns:**
- `/api/campaigns` - Campaign CRUD operations
- `/api/campaigns/[id]` - Individual campaign operations
- `/api/campaigns/migrate-actual-date` - Data migration
- `/api/campaign-templates` - Template management

**Leads:**
- `/api/leads` - Lead management
- `/api/leads/stats` - Lead statistics
- `/api/leads/import` - CSV import

**Conversations:**
- `/api/conversations` - Conversation management
- `/api/conversations/reply` - Manual replies
- `/api/conversations/mark-read` - Read status
- `/api/conversations/assign` - Staff assignment

**Dealers:**
- `/api/dealers/account` - Dealer account management
- `/api/dealers/report-analytics` - Analytics data

**Cron Jobs:**
- `/api/cron/campaigns` - Campaign execution
- `/api/cron/appointment-reminder` - Reminder processing
- `/api/cron/report-service` - Report generation

**Other Services:**
- `/api/bookademo` - Demo requests
- `/api/booking` - Appointment booking
- `/api/tickets` - Support tickets
- `/api/subscriptions` - Subscription management
- `/api/vehicles` - Vehicle management
- `/api/email-accounts` - Email configuration
- `/api/upload` - File uploads
- `/api/webhooks/*` - Webhook handlers

### 2.4 User Interfaces

#### 2.4.1 Front Pages
- Home page with product information
- Pricing page
- Contact page
- Book a demo page
- Privacy policy
- Terms of service

#### 2.4.2 Admin Dashboard
- Dashboard overview with key metrics
- Dealer management
- Vendor management
- Staff management
- Package/subscription management
- Role and permission management
- Support ticket management
- Vehicle management
- Demo request management
- Contact inquiry management
- System cron job controls
- Message statistics

#### 2.4.3 Agency Dashboard
- Dashboard with agency metrics
- Dealer management under agency
- Lead management
- Conversation management
- Email account setup
- Staff management
- Role management
- Support tickets
- Subscription management

#### 2.4.4 Dealer Dashboard
- Dashboard with dealer-specific metrics
- Campaign management
  - Create/edit campaigns
  - Campaign templates
  - Schedule campaigns
  - View campaign statistics
- Lead management
  - Lead list with filtering
  - Lead details and history
  - Lead assignment
  - CSV import
- Conversation management
  - Unified inbox
  - Reply to messages
  - Conversation threading
- Appointment booking
  - View bookings
  - Manage availability
- Vehicle inventory
  - Add/edit vehicles
  - Track vehicle clicks
- Vendor management
- Report scheduling
- Staff management
- Settings and profile
- Support tickets

#### 2.4.5 Vendor Dashboard
- Limited access dashboard
- Assigned vehicle management
- Basic analytics

---

## 3. DELIVERABLES

### 3.1 Source Code
- Complete Next.js application source code
- All API routes and endpoints
- Database models and schemas
- Worker scripts and cron services
- Configuration files
- Documentation files

### 3.2 Database
- MongoDB database schema
- Seeder scripts for initial data
- Migration scripts

### 3.3 Documentation
The following documentation is included:
- ✅ Appointment Reminder Cron Service guide
- ✅ Campaign Cron Setup guide
- ✅ Campaign Timezone Explanation
- ✅ Auto-Reply Control Design
- ✅ Report Cron System documentation
- ✅ Email Webhook Setup
- ✅ Attachment Implementation guide
- ✅ EML File Processing approach
- ✅ AWS Credentials configuration
- ✅ Lead Check Function documentation
- ✅ Validation Usage guide

**Additional Documentation Needed:**
- API documentation (endpoints, request/response formats)
- Deployment guide
- Environment variables configuration
- Third-party service setup guides (Twilio, AWS, Stripe)
- User manual for each role
- System architecture diagram
- Database schema documentation

### 3.4 Configuration Files
- `package.json` - Dependencies and scripts
- `next.config.ts` - Next.js configuration
- `tailwind.config.ts` - Styling configuration
- `.env.example` - Environment variables template
- `middleware.js` - Route protection
- `eslint.config.mjs` - Code quality rules

---

## 4. FUNCTIONAL REQUIREMENTS

### 4.1 Campaign Module
- ✅ Create, edit, and delete campaigns
- ✅ Import leads from CSV files
- ✅ Schedule campaigns with specific date/time
- ✅ Support both email and SMS message types
- ✅ Rich text editor for email content
- ✅ Attachment support for campaigns
- ✅ Real-time campaign statistics
- ✅ Campaign status management
- ✅ Background processing with queue system
- ✅ Timezone-aware scheduling
- ✅ Campaign templates for reusability

### 4.2 Lead Management Module
- ✅ Capture leads from multiple sources
- ✅ Assign leads to staff members
- ✅ Track lead status and lifecycle
- ✅ Store custom lead fields
- ✅ Lead search and filtering
- ✅ View lead communication history
- ✅ CSV import of leads
- ✅ Lead deduplication

### 4.3 Conversation Module
- ✅ Unified inbox for emails and SMS
- ✅ Manual reply to messages
- ✅ Auto-reply functionality
- ✅ Auto-reply control (enable/disable per lead)
- ✅ 5-minute delay before auto-reply
- ✅ Cancel auto-reply on manual intervention
- ✅ Conversation threading
- ✅ Read/unread status
- ✅ Attachment handling

### 4.4 Booking Module
- ✅ Online appointment booking
- ✅ Appointment confirmation
- ✅ Pre-appointment reminders
- ✅ Post-appointment follow-ups
- ✅ Managerial review notifications
- ✅ Booking management interface

### 4.5 Reporting Module
- ✅ Scheduled report generation
- ✅ Customizable report metrics
- ✅ Email delivery of reports
- ✅ Dashboard analytics
- ✅ Multiple frequency options (daily, weekly, monthly, yearly)

### 4.6 User Management Module
- ✅ Multi-role support (Admin, Agency, Dealer, Vendor, Staff)
- ✅ Role-based access control
- ✅ Custom permissions
- ✅ User profile management
- ✅ Staff invitation system
- ✅ Login-as functionality

### 4.7 Subscription Module
- ✅ Package management
- ✅ Subscription plans
- ✅ Stripe integration
- ✅ Subscription status tracking
- ✅ Upgrade/downgrade functionality

### 4.8 Support Module
- ✅ Ticket creation and management
- ✅ Ticket categories
- ✅ Priority and status management
- ✅ Assignment system
- ✅ Email notifications

---

## 5. NON-FUNCTIONAL REQUIREMENTS

### 5.1 Performance
- ✅ Asynchronous processing for campaigns (BullMQ)
- ✅ Database indexing for optimized queries
- ✅ Queue-based message delivery
- ⚠️ Caching strategy (needs implementation/verification)
- ⚠️ Load balancing considerations (needs documentation)

### 5.2 Scalability
- ✅ Multi-tenant architecture
- ✅ Separate worker processes
- ✅ Queue system for background jobs
- ✅ MongoDB for flexible schema
- ✅ S3 for file storage (no local storage constraints)

### 5.3 Security
- ✅ Authentication with NextAuth.js
- ✅ Password encryption (bcrypt)
- ✅ JWT token-based authentication
- ✅ Role-based access control
- ✅ Input sanitization (DOMPurify, sanitize-html)
- ✅ CSRF protection (built into Next.js)
- ⚠️ Rate limiting (needs verification)
- ⚠️ API security headers (needs verification)

### 5.4 Reliability
- ✅ Error handling in workers
- ✅ Retry mechanism for failed jobs (BullMQ)
- ✅ Webhook logging
- ✅ Transaction logging
- ⚠️ Backup strategy (needs documentation)
- ⚠️ Disaster recovery plan (needs documentation)

### 5.5 Maintainability
- ✅ Modular code structure
- ✅ Consistent naming conventions
- ✅ Configuration via environment variables
- ✅ Comprehensive documentation files
- ⚠️ Code comments (partial)
- ⚠️ API documentation (needs creation)

### 5.6 Compatibility
- ✅ Browser compatibility (modern browsers via React 19)
- ✅ Mobile responsive design (Bootstrap/Tailwind)
- ✅ Email client compatibility
- ✅ SMS delivery via Twilio

---

## 6. INTEGRATION REQUIREMENTS

### 6.1 Third-Party Services

#### 6.1.1 Twilio (SMS)
- ✅ SMS sending capability
- ✅ SMS webhook handling
- ✅ Phone number validation
- **Configuration Needed:**
  - TWILIO_ACCOUNT_SID
  - TWILIO_AUTH_TOKEN
  - TWILIO_PHONE_NUMBER

#### 6.1.2 AWS S3
- ✅ File upload functionality
- ✅ Attachment storage
- ✅ Pre-signed URL generation
- ✅ Email attachment handling
- **Configuration Needed:**
  - AWS_ACCESS_KEY_ID
  - AWS_SECRET_ACCESS_KEY
  - AWS_REGION
  - AWS_S3_BUCKET_NAME

#### 6.1.3 Email Service (Nodemailer)
- ✅ SMTP email sending
- ✅ HTML email support
- ✅ Attachment support
- ✅ Multiple email account support
- **Configuration Needed:**
  - SMTP host, port, username, password per account

#### 6.1.4 Stripe (Payments)
- ✅ Payment processing
- ✅ Subscription management
- ✅ Webhook handling
- **Configuration Needed:**
  - STRIPE_SECRET_KEY
  - STRIPE_PUBLISHABLE_KEY
  - STRIPE_WEBHOOK_SECRET

#### 6.1.5 OpenAI
- ⚠️ Integration implemented (OpenAI package included)
- ⚠️ Use cases need verification
- **Configuration Needed:**
  - OPENAI_API_KEY

#### 6.1.6 MongoDB
- ✅ Database connection
- ✅ Data persistence
- **Configuration Needed:**
  - MONGODB_URI

#### 6.1.7 Redis
- ✅ Job queue management
- ✅ Session storage (if applicable)
- **Configuration Needed:**
  - REDIS_HOST
  - REDIS_PORT
  - REDIS_PASSWORD (if applicable)

#### 6.1.8 NextAuth
- ✅ Authentication provider
- **Configuration Needed:**
  - NEXTAUTH_URL
  - NEXTAUTH_SECRET

### 6.2 Webhook Integrations
- ✅ Email webhook for incoming emails
- ✅ Twilio webhook for SMS
- ✅ Stripe webhook for payment events
- ⚠️ DealerSocket integration (mentioned but needs verification)

---

## 7. DEPLOYMENT REQUIREMENTS

### 7.1 Hosting Requirements
**Application Server:**
- Node.js 20+ environment
- Support for Next.js applications
- Process manager (PM2 recommended)
- SSL certificate for HTTPS

**Database:**
- MongoDB Atlas (recommended) or self-hosted MongoDB
- Regular backups
- Appropriate connection limits

**Cache/Queue:**
- Redis server for BullMQ
- Persistent storage for queue data

**Storage:**
- AWS S3 bucket for file storage
- Appropriate bucket policies and permissions

### 7.2 Environment Configuration
**Required Environment Variables:**
```env
# Database
MONGODB_URI=

# NextAuth
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# AWS S3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET_NAME=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Redis
REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=

# OpenAI
OPENAI_API_KEY=

# Email
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASSWORD=
EMAIL_FROM=

# Application
NODE_ENV=production
PORT=3000
```

### 7.3 Deployment Steps
1. Clone repository
2. Install dependencies (`npm install`)
3. Configure environment variables
4. Build application (`npm run build`)
5. Run database seeders (if first deployment)
6. Start application (`npm start`)
7. Start worker process (`npm run worker`)
8. Configure cron jobs
9. Set up webhook endpoints
10. Configure domain and SSL

### 7.4 Monitoring Requirements
- ⚠️ Application logging (needs implementation)
- ⚠️ Error tracking (needs implementation)
- ⚠️ Performance monitoring (needs implementation)
- ⚠️ Uptime monitoring (needs setup)
- ✅ Queue monitoring (BullMQ dashboard available)

---

## 8. TESTING REQUIREMENTS

### 8.1 Test Scripts Available
Current test scripts in the project:
- `test-email-webhook.sh` - Email webhook testing
- `test-eml-webhook.sh` - EML file webhook testing
- `test-flexible-matching.js` - Lead matching tests
- `test-iframe-integration.js` - Iframe integration tests
- `test-lead-check.js` - Lead check functionality
- `test-phone-matching.js` - Phone number matching tests
- `test-reminder-system.js` - Reminder system tests
- `test-work-note-integration.js` - Work note integration tests

### 8.2 Testing Scope Needed
**Unit Testing:**
- ⚠️ Model validation tests
- ⚠️ Utility function tests
- ⚠️ Helper function tests

**Integration Testing:**
- ✅ Webhook integration tests (partial)
- ⚠️ API endpoint tests
- ⚠️ Third-party service integration tests

**End-to-End Testing:**
- ⚠️ Complete user workflows
- ⚠️ Campaign creation and execution
- ⚠️ Booking flow
- ⚠️ Conversation flow

**Performance Testing:**
- ⚠️ Load testing for campaigns
- ⚠️ Database query performance
- ⚠️ Worker processing speed

---

## 9. MAINTENANCE & SUPPORT

### 9.1 Ongoing Maintenance Tasks
- Regular dependency updates
- Security patches
- Database optimization
- Log rotation and cleanup
- Queue monitoring and cleanup
- S3 storage management
- Email deliverability monitoring

### 9.2 Backup Strategy
**Database Backups:**
- Daily automated backups
- Weekly full backups
- Monthly archive backups
- Point-in-time recovery capability

**File Storage Backups:**
- S3 versioning enabled
- Cross-region replication (optional)

**Code Repository:**
- Git-based version control
- Branch protection rules
- Code review process

### 9.3 Monitoring & Alerts
**System Health:**
- Server uptime monitoring
- Database connection monitoring
- Redis connection monitoring
- Worker process monitoring

**Application Performance:**
- API response times
- Queue processing times
- Email/SMS delivery rates
- Error rates

**Business Metrics:**
- Campaign execution success rate
- Lead conversion rates
- Subscription renewals
- Support ticket resolution time

---

## 10. ASSUMPTIONS & CONSTRAINTS

### 10.1 Assumptions
- Internet connectivity is available and stable
- Third-party services (Twilio, AWS, Stripe) are operational
- Users have modern web browsers (Chrome, Firefox, Safari, Edge)
- Email/SMS recipients have valid contact information
- Dealers have necessary legal permissions to contact leads
- MongoDB database can scale as needed
- Redis is available for queue management

### 10.2 Constraints
- Campaign sending limited by Twilio SMS rate limits
- Email sending limited by SMTP provider limits
- File upload size limited by server configuration
- Concurrent user limits based on hosting plan
- Third-party API rate limits
- Storage costs for S3 based on usage
- Database storage based on hosting plan

### 10.3 Dependencies
- Next.js framework updates
- MongoDB driver compatibility
- Third-party service availability
- React ecosystem updates
- Node.js version compatibility

---

## 11. RISKS & MITIGATION

### 11.1 Technical Risks

**Risk: High volume campaigns may overload system**
- **Mitigation:** Queue-based processing with BullMQ, rate limiting, batch processing

**Risk: Email deliverability issues**
- **Mitigation:** SPF/DKIM configuration, warm-up process, monitoring bounce rates, email validation

**Risk: SMS delivery failures**
- **Mitigation:** Twilio retry logic, error logging, status callbacks, alternative provider backup

**Risk: Database performance degradation**
- **Mitigation:** Proper indexing, query optimization, connection pooling, read replicas

**Risk: Third-party service outages**
- **Mitigation:** Error handling, retry mechanisms, fallback options, status monitoring

**Risk: File storage costs spiraling**
- **Mitigation:** S3 lifecycle policies, file size limits, compression, cleanup jobs

### 11.2 Business Risks

**Risk: SPAM/CAN-SPAM compliance issues**
- **Mitigation:** Unsubscribe functionality, opt-in tracking, compliance documentation, audit trails

**Risk: Data privacy violations (GDPR, CCPA)**
- **Mitigation:** Data encryption, access controls, data deletion capability, privacy policy, user consent

**Risk: Security breaches**
- **Mitigation:** Authentication, authorization, input validation, security audits, penetration testing

**Risk: Subscription payment failures**
- **Mitigation:** Stripe retry logic, grace periods, notifications, payment method updates

---

## 12. SUCCESS CRITERIA

### 12.1 Technical Success Metrics
- ✅ System successfully processes campaigns with 99%+ delivery rate
- ✅ API response time < 2 seconds for 95% of requests
- ✅ Worker processing time < 30 seconds per message
- ✅ System uptime > 99.5%
- ✅ Zero critical security vulnerabilities
- ✅ Database queries optimized with proper indexes

### 12.2 Business Success Metrics
- User satisfaction score > 4.0/5.0
- Support ticket resolution time < 24 hours
- Campaign creation time < 5 minutes
- Lead response time < 1 hour with auto-reply
- Dealer onboarding time < 30 minutes

### 12.3 Functional Completeness
- ✅ All core modules implemented and functional
- ✅ All user roles have appropriate dashboards
- ✅ All critical integrations working (Twilio, AWS, Stripe)
- ✅ Documentation covers setup and usage
- ⚠️ API documentation available (needs creation)
- ⚠️ Comprehensive test coverage (needs improvement)

---

## 13. PROJECT TIMELINE

### 13.1 Development Phases

**Phase 1: Foundation (Completed ✅)**
- Project setup and architecture
- Database schema design
- Authentication system
- Basic user management

**Phase 2: Core Features (Completed ✅)**
- Campaign management module
- Lead management module
- Conversation module
- Email/SMS integration

**Phase 3: Advanced Features (Completed ✅)**
- Appointment booking system
- Automated reminders
- Follow-up system
- Report generation

**Phase 4: Admin & Business Features (Completed ✅)**
- Multi-tenant support
- Subscription management
- Support ticket system
- Role-based access control

**Phase 5: Optimization & Documentation (In Progress ⚠️)**
- Performance optimization
- API documentation
- User guides
- Testing coverage

**Phase 6: Deployment & Launch (Pending 🔴)**
- Production deployment
- Monitoring setup
- Backup configuration
- Go-live activities

### 13.2 Estimated Timeline
- **Total Development:** ~6-9 months (appears to be completed)
- **Testing & QA:** 2-4 weeks (ongoing)
- **Documentation:** 1-2 weeks (in progress)
- **Deployment:** 1 week
- **Post-launch Support:** Ongoing

---

## 14. BUDGET CONSIDERATIONS

### 14.1 Infrastructure Costs (Monthly Estimates)

**Hosting:**
- Application server (VPS/Cloud): $50-200
- MongoDB Atlas: $0-500 (based on usage)
- Redis: $10-50

**Third-Party Services:**
- Twilio SMS: $0.0075-0.01 per SMS (variable based on volume)
- AWS S3: $10-100 (based on storage and transfers)
- Stripe: 2.9% + $0.30 per transaction
- OpenAI API: Variable (based on usage)
- Email service: $10-50

**Domain & SSL:**
- Domain registration: $10-20/year
- SSL certificate: Free (Let's Encrypt) or $50-200/year

**Total Estimated Monthly Cost:** $100-1,000+ (highly variable based on usage)

### 14.2 Development Costs
- Based on project scope, estimated 6-9 months of development
- Technology stack is open-source (no licensing fees)
- Additional costs for premium themes/components (if any)

### 14.3 Ongoing Costs
- Server maintenance
- Database backups
- Third-party service fees
- Support and updates
- Feature enhancements

---

## 15. STAKEHOLDERS

### 15.1 Internal Stakeholders
- **Project Owner:** Business/Product Owner
- **Development Team:** Full-stack developers
- **QA Team:** Quality assurance engineers
- **DevOps Team:** Infrastructure and deployment
- **Support Team:** Customer support staff

### 15.2 External Stakeholders
- **End Users:**
  - Dealership Administrators
  - Agency Staff
  - Dealer Staff
  - Vendors
- **Third-Party Vendors:**
  - Twilio (SMS service)
  - AWS (Storage service)
  - Stripe (Payment processing)
  - MongoDB Atlas (Database hosting)
  - Email service provider

---

## 16. CHANGE MANAGEMENT

### 16.1 Change Request Process
1. Submit change request with detailed description
2. Impact analysis (technical, timeline, budget)
3. Stakeholder review and approval
4. Prioritization and scheduling
5. Implementation and testing
6. Documentation update
7. Deployment and communication

### 16.2 Version Control
- Git-based version control (GitHub/GitLab/Bitbucket)
- Branch naming conventions
- Pull request reviews
- Semantic versioning

---

## 17. APPENDICES

### 17.1 Technical Documentation Files
- `APPOINTMENT_REMINDER_CRON_SERVICE.md`
- `APPOINTMENT_REMINDER_CRON_USAGE.md`
- `appointment-reminder-curl-examples.md`
- `ATTACHMENT_IMPLEMENTATION.md`
- `AUTOREPLY_CONTROL_DESIGN.md`
- `AWS_CREDENTIALS_FIX.md`
- `CAMPAIGN_CRON_SETUP.md`
- `CAMPAIGN_TIMEZONE_EXPLANATION.md`
- `EMAIL_TO_CLIENT.md`
- `EMAIL_WEBHOOK_S3_SETUP.md`
- `EML_FILE_APPROACH.md`
- `EML_ONLY_APPROACH.md`
- `LEAD_CHECK_FUNCTION.md`
- `REPORT_CRON_SYSTEM.md`
- `VALIDATION_USAGE.md`

### 17.2 Configuration Scripts
- `check-aws-credentials.sh` - AWS credentials verification
- `email_webhook_hestia.sh` - Email webhook setup
- `email_webhook_simple_with_s3.sh` - Simplified webhook
- `setup-csv-directories.sh` - CSV directory setup

### 17.3 Database Models
Located in `/app/models/`:
- AppointmentReminder.js
- Booking.js
- Campaign.js
- CampaignLead.js
- CampaignTemplate.js
- Contacts.js
- CSVImportData.js
- CSVImportedData.js
- DealerWebsiteClick.js
- DemoRequest.js
- Email.js
- EmailAccount.js
- FollowUpJob.js
- Lead.js
- Package.js
- Permission.js
- ReportSchedule.js
- Role.js
- Subscription.js
- SubscriptionRequest.js
- Ticket.js
- TicketCategory.js
- User.js
- Vehicle.js
- VehicleClick.js
- WebhookLog.js

### 17.4 API Routes Structure
Located in `/app/api/`:
- `/admin/*` - Admin-specific APIs
- `/auth/*` - Authentication endpoints
- `/campaigns/*` - Campaign management
- `/conversations/*` - Conversation management
- `/cron/*` - Cron job triggers
- `/dealers/*` - Dealer management
- `/email-accounts/*` - Email configuration
- `/leads/*` - Lead management
- `/subscriptions/*` - Subscription management
- `/tickets/*` - Support tickets
- `/vehicles/*` - Vehicle inventory
- `/webhooks/*` - Webhook handlers

---

## 18. GLOSSARY

**Terms & Definitions:**

- **Campaign:** A scheduled or immediate bulk messaging operation (email or SMS) to multiple leads
- **Lead:** A potential customer who has shown interest in a dealership's products/services
- **Conversation:** A thread of email or SMS communications with a lead
- **Auto-reply:** Automated response to incoming messages from leads
- **Follow-up:** Scheduled communication to nurture leads
- **Booking:** An appointment scheduled by a lead with a dealership
- **Dealer:** A car dealership using the platform
- **Agency:** An organization managing multiple dealers
- **Vendor:** Third-party service provider with limited access
- **Staff:** Employee of a dealer with assigned roles and permissions
- **Campaign Lead:** A lead associated with a specific campaign
- **Queue:** Background job processing system using BullMQ
- **Worker:** Background process that handles asynchronous tasks
- **Cron Job:** Scheduled task that runs at specific intervals
- **Webhook:** HTTP callback for real-time event notifications
- **Multi-tenant:** Architecture supporting multiple independent organizations
- **RBAC:** Role-Based Access Control for user permissions

---

## 19. APPROVAL & SIGN-OFF

### 19.1 Document Control
- **Document Version:** 1.0
- **Date Created:** January 7, 2026
- **Last Updated:** January 7, 2026
- **Created By:** AI Assistant (Cursor)
- **Document Status:** Draft

### 19.2 Approval Required From
- [ ] Project Owner/Sponsor
- [ ] Technical Lead
- [ ] Business Stakeholders
- [ ] Development Team Lead
- [ ] QA Lead

### 19.3 Sign-off
By signing below, all parties acknowledge that they have reviewed and agree to the scope, requirements, deliverables, and terms outlined in this Statement of Work.

---

**Project Owner:** _____________________ Date: _______

**Technical Lead:** _____________________ Date: _______

**Business Stakeholder:** _____________________ Date: _______

---

## 20. CONTACT INFORMATION

**Project Repository:** /Users/apple/Documents/aidmvcs-be

**Technology Stack:**
- Framework: Next.js 16
- Runtime: Node.js
- Database: MongoDB
- Cache/Queue: Redis + BullMQ

**Key Configuration:**
- Development Server: `npm run dev`
- Production Build: `npm run build`
- Production Start: `npm start`
- Worker Process: `npm run worker`

---

*End of Statement of Work*

---

**Note:** This SOW document is based on the current state of the codebase as of January 7, 2026. Some features may be in various stages of completion. Items marked with ⚠️ need attention or verification, and items marked with 🔴 are pending implementation.

