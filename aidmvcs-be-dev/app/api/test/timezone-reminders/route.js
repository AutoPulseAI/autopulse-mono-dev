import { NextResponse } from 'next/server';
import { createAppointmentReminders } from '@lib/appointmentReminderService';
import dbConnect from '@lib/mongodb';
import User from '@models/User';

export async function POST(req) {
  try {
    const body = await req.json();
    const { dealerId, bookingDate, bookingTime, timezone } = body;

    if (!dealerId || !bookingDate || !bookingTime) {
      return NextResponse.json({
        success: false,
        message: 'Missing required fields: dealerId, bookingDate, bookingTime'
      }, { status: 400 });
    }

    await dbConnect();

    // Get dealer information
    const dealer = await User.findById(dealerId);
    if (!dealer) {
      return NextResponse.json({
        success: false,
        message: 'Dealer not found'
      }, { status: 404 });
    }

    // Update dealer timezone if provided
    if (timezone) {
      dealer.dealer_account_information = dealer.dealer_account_information || {};
      dealer.dealer_account_information.time_zone = timezone;
      await dealer.save();
    }

    const currentTimezone = dealer.dealer_account_information?.time_zone || 'America/New_York';

    // Create test booking
    const testBooking = {
      _id: `test-booking-${Date.now()}`,
      customer_name: 'Test Customer',
      customer_email: 'test@example.com',
      customer_phone: '+1234567890',
      booking_date: bookingDate,
      time: bookingTime
    };

    // Create reminders
    const result = await createAppointmentReminders(testBooking, dealerId);

    return NextResponse.json({
      success: true,
      message: 'Test reminders created',
      dealerTimezone: currentTimezone,
      testBooking: testBooking,
      result: result
    });

  } catch (error) {
    console.error('Error in timezone test:', error);
    return NextResponse.json({
      success: false,
      message: 'Error creating test reminders',
      error: error.message
    }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dealerId = searchParams.get('dealerId');

    if (!dealerId) {
      return NextResponse.json({
        success: false,
        message: 'dealerId is required'
      }, { status: 400 });
    }

    await dbConnect();

    const dealer = await User.findById(dealerId);
    if (!dealer) {
      return NextResponse.json({
        success: false,
        message: 'Dealer not found'
      }, { status: 404 });
    }

    const timezone = dealer.dealer_account_information?.time_zone || 'America/New_York';
    const reminderSettings = dealer.appointment_reminder_settings;

    return NextResponse.json({
      success: true,
      dealer: {
        id: dealer._id,
        name: dealer.name,
        timezone: timezone,
        reminderSettings: reminderSettings
      }
    });

  } catch (error) {
    console.error('Error getting dealer timezone info:', error);
    return NextResponse.json({
      success: false,
      message: 'Error getting dealer information',
      error: error.message
    }, { status: 500 });
  }
}
