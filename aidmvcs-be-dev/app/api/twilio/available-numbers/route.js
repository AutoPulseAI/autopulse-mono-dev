import twilioService from '../../../lib/twilioService.js';
import dbConnect from '../../../lib/mongodb.js';
import User from '../../../models/User.js';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const areaCode = searchParams.get('area_code');
    const limit = parseInt(searchParams.get('limit')) || 50;
    
    // Check if Twilio is configured
    if (!twilioService.isConfigured()) {
      return Response.json({
        success: false,
        error: 'Twilio service not configured. Please check environment variables.',
        config_required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']
      }, { status: 503 });
    }
    
    // Get existing phone numbers from your Twilio account (already purchased)
    const existingTwilioNumbers = await twilioService.getExistingPhoneNumbers();
    
    // Get all users to check which numbers are already assigned
    const users = await User.find({
      'dealer_account_information.sms_conversion_phone': { $exists: true, $ne: '' }
    }).select('dealer_account_information.sms_conversion_phone');
    
    const assignedNumbers = users.map(user => 
      user.dealer_account_information?.sms_conversion_phone
    ).filter(Boolean);
    
    // Filter to show only unassigned numbers from your existing Twilio account
    const availableNumbers = existingTwilioNumbers.filter(twilioNum => 
      !assignedNumbers.includes(twilioNum.phoneNumber)
    );
    
    // Apply area code filter if provided
    let filteredNumbers = availableNumbers;
    if (areaCode && /^\d{3}$/.test(areaCode)) {
      filteredNumbers = availableNumbers.filter(number => 
        number.phoneNumber.substring(2, 5) === areaCode
      );
    }
    
    // Limit results
    filteredNumbers = filteredNumbers.slice(0, limit);
    
    // Format numbers for display
    const formattedNumbers = filteredNumbers.map(number => ({
      id: `twilio_${number.phoneNumber.replace(/\D/g, '')}`,
      phone_number: number.phoneNumber,
      formatted_number: formatPhoneNumber(number.phoneNumber),
      area_code: number.phoneNumber.substring(2, 5),
      locality: number.locality || '',
      region: number.region || '',
      country: number.country || 'US',
      capabilities: number.capabilities,
      source: 'twilio_owned',
      monthly_cost: 1.00, // Standard Twilio monthly cost
      twilio_sid: number.sid,
      status: number.status,
      date_created: number.dateCreated,
      date_updated: number.dateUpdated
    }));
    
    // Get area code distribution
    const areaCodeStats = {};
    formattedNumbers.forEach(number => {
      const areaCode = number.area_code;
      areaCodeStats[areaCode] = (areaCodeStats[areaCode] || 0) + 1;
    });
    
    const areaCodeArray = Object.entries(areaCodeStats).map(([code, count]) => ({
      _id: code,
      count: count
    })).sort((a, b) => a._id.localeCompare(b._id));
    
    return Response.json({
      success: true,
      message: `Found ${formattedNumbers.length} unassigned phone numbers from your Twilio account`,
      data: {
        phone_numbers: formattedNumbers,
        area_code_stats: areaCodeArray,
        total_available: formattedNumbers.length,
        total_owned: existingTwilioNumbers.length,
        total_assigned: assignedNumbers.length,
        filters: {
          area_code: areaCode || 'all',
          limit: limit
        },
        source: 'twilio_owned',
        note: 'These are phone numbers already purchased from your Twilio account'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching existing Twilio numbers:', error);
    return Response.json({
      success: false,
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await dbConnect();
    
    const { phone_number } = await request.json();
    
    if (!phone_number ) {
      return Response.json({
        success: false,
        error: 'Phone number is required'
      }, { status: 400 });
    }
    
    // Validate phone number format (must start with +1)
    if (!phone_number.startsWith('+1')) {
      return Response.json({
        success: false,
        error: 'Phone number must be in +1XXXXXXXXXX format'
      }, { status: 400 });
    }
    
    // Check if user exists
    
    
    // Check if phone number is already assigned to another user
    const existingUser = await User.findOne({
      'dealer_account_information.sms_conversion_phone': phone_number,
     
    });
    
    if (existingUser) {
      return Response.json({
        success: false,
        error: 'Phone number is already assigned to another user'
      }, { status: 409 });
    }
    
    // Since the number is already purchased, just assign it to the user
    
    
    return Response.json({
      success: true,
      message: 'Phone number assigned successfully',
      data: {
        phone_number: phone_number,
        formatted_number: formatPhoneNumber(phone_number),
        
        assigned_at: new Date().toISOString(),
        note: 'Phone number was already purchased from your Twilio account'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error assigning phone number:', error);
    return Response.json({
      success: false,
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
}

// Helper function to format phone number
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  
  // Remove any non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `(${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7, 11)}`;
  } else if (cleaned.length === 10) {
    return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6, 10)}`;
  }
  
  return phoneNumber;
}
