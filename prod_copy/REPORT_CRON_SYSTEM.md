# Report Cron Job System

This document explains how the automated report system works and how to use it.

## Overview

The report cron job system automatically generates and sends reports to dealers based on their schedule settings. It runs every minute to check for scheduled reports and sends them via email.

## How It Works

### 1. Schedule Configuration
- Dealers configure report schedules in the report-schedule page
- Each schedule specifies:
  - **Frequency**: daily, weekly, monthly, or yearly
  - **Time**: specific time (e.g., 09:00)
  - **Days**: specific days or dates based on frequency
  - **Email**: recipient email address
  - **Metrics**: which data to include (leads, conversations, vehicles, revenue)

### 2. Data Structure
- **Weekly**: `days: ["monday"]` (single day name)
- **Monthly**: `days: ["15"]` (single date number 1-31)
- **Yearly**: `days: ["january", "20"]` (month + date)
- **Daily**: `days: []` (empty array)

### 3. Cron Job Execution
- Service runs every minute
- Checks current time against all active schedules
- Generates reports for matching schedules
- Sends reports via email
- Updates last sent timestamp

## Components

### 1. Report Scheduler (`app/utils/reportScheduler.js`)
- Core logic for determining when reports should run
- Functions to calculate next execution times
- Data validation and conversion

### 2. Report Generator (`app/lib/reportGenerator.js`)
- Generates report content based on schedule settings
- Fetches data from database (leads, conversations, vehicles, revenue)
- Creates HTML email templates
- Sends reports via email

### 3. Cron Service (`app/lib/reportCronService.js`)
- Main service that runs the cron job
- Checks for scheduled reports every minute
- Orchestrates report generation and sending
- Provides start/stop/status control

### 4. API Endpoints
- `/api/cron/report-service` - Control cron service (start/stop/check)

### 5. Admin Control Panel
- Component in admin dashboard to control the service
- Start/stop service
- Manual report check
- Service status monitoring

## Usage

### Starting the Service

#### Option 1: Automatic (Recommended)
The service automatically starts when the application starts. Add this to your main application file:

```javascript
import { initializeServices } from '@lib/startup';

// On app startup
initializeServices();
```

#### Option 2: Manual via API
```bash
curl -X POST http://localhost:3000/api/cron/report-service \
  -H "Content-Type: application/json" \
  -d '{"action": "start"}'
```

#### Option 3: Admin Dashboard
1. Go to Admin Dashboard
2. Find "Report Cron Service Control" section
3. Click "Start Service" button

### Stopping the Service

#### Via API
```bash
curl -X POST http://localhost:3000/api/cron/report-service \
  -H "Content-Type: application/json" \
  -d '{"action": "stop"}'
```

#### Via Admin Dashboard
1. Go to Admin Dashboard
2. Find "Report Cron Service Control" section
3. Click "Stop Service" button

### Manual Report Check

#### Via API
```bash
curl -X POST http://localhost:3000/api/cron/report-service \
  -H "Content-Type: application/json" \
  -d '{"action": "check"}'
```

#### Via Admin Dashboard
1. Go to Admin Dashboard
2. Find "Report Cron Service Control" section
3. Click "Manual Check" button

### Checking Service Status

#### Via API
```bash
curl http://localhost:3000/api/cron/report-service
```

#### Via Admin Dashboard
The status is displayed in the "Report Cron Service Control" section.

## Configuration

### Check Interval
The service checks for scheduled reports every minute by default. To change this:

```javascript
// In reportCronService.js
this.checkInterval = 30000; // 30 seconds
```

### Email Templates
Customize email templates in `app/lib/reportGenerator.js`:

```javascript
function generateEmailHTML(userName, reportContent, settings) {
  // Customize HTML template here
}
```

### Report Metrics
Configure which metrics to include in reports:

```javascript
// In the report schedule settings
include_metrics: {
  leads: true,           // Include lead data
  conversations: true,   // Include conversation data
  vehicles: true,        // Include vehicle data
  revenue: true          // Include revenue data
}
```

## Monitoring

### Logs
The service logs all activities to the console:
- Service start/stop
- Report checks
- Report generation
- Email sending
- Errors and exceptions

### Status Monitoring
Monitor service status via:
- Admin dashboard
- API endpoint
- Console logs

## Troubleshooting

### Service Won't Start
1. Check console for error messages
2. Verify database connection
3. Check if service is already running

### Reports Not Sending
1. Verify service is running
2. Check schedule configurations
3. Verify email settings
4. Check console logs for errors

### Performance Issues
1. Reduce check interval if needed
2. Optimize database queries
3. Monitor memory usage

## Security Considerations

1. **Access Control**: Only admins can control the cron service
2. **Data Privacy**: Reports only include data the user has access to
3. **Rate Limiting**: Built-in rate limiting for email sending
4. **Error Handling**: Graceful error handling to prevent service crashes

## Future Enhancements

1. **Multiple Email Providers**: Support for different email services
2. **Report Templates**: Customizable report templates
3. **Advanced Scheduling**: More complex scheduling options
4. **Report History**: Track sent reports and delivery status
5. **Analytics**: Report performance metrics

## Support

For issues or questions:
1. Check console logs
2. Review this documentation
3. Check the admin dashboard for service status
4. Contact system administrator
