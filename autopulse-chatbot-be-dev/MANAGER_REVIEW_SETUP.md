# Manager Review Notification System

## Overview

This system automatically sends email and SMS notifications to managers when a chatbot conversation requires manual review. The notifications include the user's query, chatbot ID, conversation details, and other relevant information.

## Features

- ✅ **Email Notifications** - Rich HTML emails with conversation details
- ✅ **SMS Notifications** - Text messages via Twilio
- ✅ **Automatic Triggering** - Based on `manager_review` flag from chatbot response
- ✅ **Comprehensive Logging** - All notifications are logged for debugging
- ✅ **Error Handling** - Graceful failure handling with detailed error logs
- ✅ **Test Commands** - Built-in testing functionality

## Setup Instructions

### 1. Environment Configuration

Add the following variables to your `.env` file:

```env
# Twilio SMS Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+1234567890
TWILIO_API_KEY=your_twilio_api_key
TWILIO_API_URL=https://api.twilio.com/2010-04-01

# Email Configuration (already configured)
MAIL_MAILER=smtp
MAIL_HOST=your_smtp_host
MAIL_PORT=587
MAIL_USERNAME=your_email
MAIL_PASSWORD=your_password
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=noreply@yourdomain.com
MAIL_FROM_NAME="${APP_NAME}"
```

### 2. Twilio Setup

1. **Create Twilio Account**: Sign up at [twilio.com](https://twilio.com)
2. **Get Credentials**: 
   - Account SID
   - Auth Token
   - Phone Number (for sending SMS)
3. **Update Environment**: Add credentials to `.env` file

### 3. Manager Contact Configuration

Ensure managers have their contact information configured in the chat settings:

1. **Access Chat Settings**: Go to dealer chat settings page
2. **Fill Managerial Contact**:
   - Managerial Contact Phone (e.g., +1-555-123-4567)
   - Managerial Contact Email (e.g., manager@dealership.com)
3. **Save Settings**: Update the configuration

## How It Works

### 1. Trigger Condition

The system triggers when the chatbot response includes:
```json
{
  "manager_review": true
}
```

### 2. Notification Process

When triggered, the system:

1. **Extracts Information**:
   - User query from the request
   - Conversation ID
   - Chatbot ID
   - Dealership name
   - Manager contact details

2. **Sends Email** (if manager email is configured):
   - Rich HTML email with conversation details
   - User query highlighted
   - Direct link to view conversation
   - Professional formatting

3. **Sends SMS** (if manager phone is configured):
   - Concise text message
   - Key conversation details
   - Formatted for mobile viewing

4. **Logs Everything**:
   - Success/failure status
   - Error details if any
   - Conversation metadata

### 3. Email Template

The email includes:
- **Header**: Clear "Manager Review Required" title
- **User Query**: Highlighted customer question
- **Conversation Details**: Chatbot ID, dealership, timestamp
- **Action Required**: List of possible actions
- **Direct Link**: Button to view full conversation

### 4. SMS Format

```
🔍 MANAGER REVIEW REQUIRED

Dealership: [Dealership Name]
Customer Query: "[User Query]"
Chatbot ID: [Chatbot ID]
Conversation ID: [Conversation ID]
Time: [Timestamp]

Please review this conversation and take appropriate action if needed.
```

## Testing

### 1. Test Command

Use the built-in test command:

```bash
# Test SMS only
php artisan test:sms +1234567890

# Test Email only
php artisan test:sms +1234567890 --email=manager@dealership.com

# Test both
php artisan test:sms +1234567890 --email=manager@dealership.com
```

### 2. Manual Testing

1. **Configure Manager Contact**: Set phone and email in chat settings
2. **Trigger Review**: Send a message that triggers `manager_review: true`
3. **Check Notifications**: Verify email and SMS are received
4. **Check Logs**: Review Laravel logs for any issues

## File Structure

```
app/
├── Mail/
│   └── ManagerReviewNotification.php    # Email notification class
├── Services/
│   └── SmsService.php                   # SMS service using Twilio
├── Http/Controllers/
│   └── ChatController.php               # Updated with notification logic
└── Console/Commands/
    └── TestSmsNotification.php          # Test command

resources/views/emails/
└── manager-review-notification.blade.php # Email template

config/
└── services.php                         # Twilio configuration
```

## Configuration Options

### SMS Service Configuration

```php
// config/services.php
'twilio' => [
    'account_sid' => env('TWILIO_ACCOUNT_SID'),
    'auth_token' => env('TWILIO_AUTH_TOKEN'),
    'from_number' => env('TWILIO_FROM_NUMBER'),
    'api_key' => env('TWILIO_API_KEY'),
    'api_url' => env('TWILIO_API_URL', 'https://api.twilio.com/2010-04-01'),
],
```

### Phone Number Formatting

The system automatically formats phone numbers:
- Removes non-numeric characters except `+`
- Adds `+1` for US numbers if not present
- Validates format before sending

### Email Template Customization

Edit `resources/views/emails/manager-review-notification.blade.php` to customize:
- Styling and colors
- Content layout
- Additional information
- Call-to-action buttons

## Error Handling

### Common Issues

1. **SMS Not Sending**:
   - Check Twilio credentials
   - Verify phone number format
   - Check account balance
   - Review error logs

2. **Email Not Sending**:
   - Check SMTP configuration
   - Verify email address format
   - Check mail server status
   - Review error logs

3. **Missing Manager Contact**:
   - Ensure managerial contact fields are filled
   - Check database migration was run
   - Verify form submission

### Logging

All notifications are logged with:
- Success/failure status
- Error messages
- Conversation details
- Timestamps

Check logs at: `storage/logs/laravel.log`

## Security Considerations

1. **Phone Number Privacy**: Only store necessary contact information
2. **Email Security**: Use secure SMTP connections
3. **Logging**: Avoid logging sensitive customer data
4. **Access Control**: Ensure only authorized personnel can view conversations

## Troubleshooting

### Debug Steps

1. **Check Configuration**:
   ```bash
   php artisan config:cache
   php artisan config:clear
   ```

2. **Test Individual Components**:
   ```bash
   # Test SMS service
   php artisan test:sms +1234567890
   
   # Test email service
   php artisan test:sms +1234567890 --email=test@example.com
   ```

3. **Check Logs**:
   ```bash
   tail -f storage/logs/laravel.log
   ```

4. **Verify Database**:
   ```sql
   SELECT managerial_contact_phone, managerial_contact_email 
   FROM chatbot_settings 
   WHERE dealer_id = [your_dealer_id];
   ```

## Support

For issues or questions:
1. Check the logs first
2. Verify configuration
3. Test with the provided commands
4. Review this documentation

The system is designed to be robust and provide detailed logging for easy troubleshooting.
