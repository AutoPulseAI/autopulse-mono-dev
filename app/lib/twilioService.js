import twilio from 'twilio';

class TwilioService {
  constructor() {
    this.client = null;
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (this.accountSid && this.authToken) {
      this.client = twilio(this.accountSid, this.authToken);
    }
  }

  /**
   * Check if Twilio is configured
   */
  isConfigured() {
    return !!(this.client && this.accountSid && this.authToken);
  }

  /**
   * Get available phone numbers from Twilio
   */
  async getAvailablePhoneNumbers(countryCode = 'US', areaCode = null, limit = 20) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Twilio not configured. Please check environment variables.');
      }

      const params = {
        voice: false,
        sms: true,
        limit: limit
      };

      // Add area code filter if provided
      if (areaCode && /^\d{3}$/.test(areaCode)) {
        params.areaCode = areaCode;
      }

      const availableNumbers = await this.client.availablePhoneNumbers(countryCode)
        .local
        .list(params);

      return availableNumbers.map(number => ({
        phoneNumber: number.phoneNumber,
        friendlyName: number.friendlyName || number.phoneNumber,
        locality: number.locality || '',
        region: number.region || '',
        country: number.country || countryCode,
        capabilities: {
          voice: number.capabilities?.voice || false,
          sms: number.capabilities?.sms || true,
          mms: number.capabilities?.mms || false
        },
        beta: number.beta || false
      }));

    } catch (error) {
      console.error('Error fetching available phone numbers from Twilio:', error);
      throw error;
    }
  }

  /**
   * Purchase a phone number from Twilio
   */
  async purchasePhoneNumber(phoneNumber, friendlyName = null) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Twilio not configured. Please check environment variables.');
      }

      const params = {
        phoneNumber: phoneNumber
      };

      if (friendlyName) {
        params.friendlyName = friendlyName;
      }

      const incomingPhoneNumber = await this.client.incomingPhoneNumbers
        .create(params);

      return {
        sid: incomingPhoneNumber.sid,
        phoneNumber: incomingPhoneNumber.phoneNumber,
        friendlyName: incomingPhoneNumber.friendlyName,
        status: 'active'
      };

    } catch (error) {
      console.error('Error purchasing phone number from Twilio:', error);
      throw error;
    }
  }

  /**
   * Get existing phone numbers from Twilio account
   */
  async getExistingPhoneNumbers() {
    try {
      if (!this.isConfigured()) {
        throw new Error('Twilio not configured. Please check environment variables.');
      }

      const phoneNumbers = await this.client.incomingPhoneNumbers
        .list({ limit: 1000 });

      return phoneNumbers.map(number => ({
        sid: number.sid,
        phoneNumber: number.phoneNumber,
        friendlyName: number.friendlyName || number.phoneNumber,
        status: number.status,
        capabilities: {
          voice: number.capabilities?.voice || false,
          sms: number.capabilities?.sms || true,
          mms: number.capabilities?.mms || false
        },
        dateCreated: number.dateCreated,
        dateUpdated: number.dateUpdated
      }));

    } catch (error) {
      console.error('Error fetching existing phone numbers from Twilio:', error);
      throw error;
    }
  }

  /**
   * Check if a phone number is available for purchase
   */
  async checkPhoneNumberAvailability(phoneNumber) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Twilio not configured. Please check environment variables.');
      }

      // Try to purchase the number temporarily to check availability
      const params = {
        phoneNumber: phoneNumber
      };

      const incomingPhoneNumber = await this.client.incomingPhoneNumbers
        .create(params);

      // If successful, immediately delete it (this was just a check)
      await this.client.incomingPhoneNumbers(incomingPhoneNumber.sid)
        .remove();

      return {
        available: true,
        phoneNumber: phoneNumber,
        message: 'Phone number is available for purchase'
      };

    } catch (error) {
      if (error.code === 20008) {
        // Number already exists in your account
        return {
          available: false,
          phoneNumber: phoneNumber,
          message: 'Phone number already exists in your account',
          reason: 'already_owned'
        };
      } else if (error.code === 20009) {
        // Number is not available
        return {
          available: false,
          phoneNumber: phoneNumber,
          message: 'Phone number is not available for purchase',
          reason: 'not_available'
        };
      } else {
        return {
          available: false,
          phoneNumber: phoneNumber,
          message: 'Error checking availability',
          reason: 'error',
          error: error.message
        };
      }
    }
  }
}

// Create singleton instance
const twilioService = new TwilioService();

export default twilioService;
