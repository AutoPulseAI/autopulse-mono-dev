import twilioService from '../../../lib/twilioService.js';

export async function GET() {
  try {
    // Check if Twilio is configured
    const isConfigured = twilioService.isConfigured();
    
    if (!isConfigured) {
      return Response.json({
        success: false,
        message: 'Twilio not configured',
        required_env_vars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
        current_status: {
          account_sid: !!process.env.TWILIO_ACCOUNT_SID,
          auth_token: !!process.env.TWILIO_AUTH_TOKEN
        }
      });
    }

    // Try to get available numbers (limited to 5 for testing)
    const availableNumbers = await twilioService.getAvailablePhoneNumbers('US', null, 5);
    
    return Response.json({
      success: true,
      message: 'Twilio service is working',
      available_numbers_count: availableNumbers.length,
      sample_numbers: availableNumbers.slice(0, 3).map(num => ({
        phone_number: num.phoneNumber,
        locality: num.locality,
        region: num.region,
        capabilities: num.capabilities
      })),
      service_status: 'operational'
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: 'Twilio service error',
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
