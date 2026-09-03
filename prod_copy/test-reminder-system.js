/**
 * Test script for the appointment reminder system
 * Run with: node test-reminder-system.js
 */

import { createAppointmentReminders, getPendingReminders, processAllPendingReminders } from './app/lib/appointmentReminderService.js';
import dbConnect from './app/lib/mongodb.js';

async function testReminderSystem() {
  console.log('🧪 Testing Appointment Reminder System\n');

  try {
    await dbConnect();
    console.log('✅ Connected to database\n');

    // Test 1: Check pending reminders
    console.log('📋 Test 1: Checking pending reminders...');
    const pendingReminders = await getPendingReminders();
    console.log(`Found ${pendingReminders.length} pending reminders\n`);

    // Test 2: Process reminders manually
    console.log('🔄 Test 2: Processing reminders manually...');
    const result = await processAllPendingReminders();
    console.log('Processing result:', result);
    console.log('');

    // Test 3: Create a test booking (you'll need to replace with actual dealer ID)
    console.log('📅 Test 3: Creating test reminders...');
    const testBooking = {
      _id: 'test-booking-123',
      customer_name: 'John Doe',
      customer_email: 'john@example.com',
      customer_phone: '+1234567890',
      booking_date: '2024-01-15', // Fixed date for testing
      time: '14:00'
    };
    
    const testDealerId = '68e6f270ac63d8a8eba32096'; // Replace with actual dealer ID
    
    const reminderResult = await createAppointmentReminders(testBooking, testDealerId);
    console.log('Reminder creation result:', reminderResult);
    console.log('');

    // Test 4: Check pending reminders again
    console.log('📋 Test 4: Checking pending reminders after creation...');
    const newPendingReminders = await getPendingReminders();
    console.log(`Found ${newPendingReminders.length} pending reminders`);
    
    if (newPendingReminders.length > 0) {
      console.log('Sample reminder:', {
        id: newPendingReminders[0]._id,
        customer: newPendingReminders[0].customer_name,
        scheduled_for: newPendingReminders[0].scheduled_for,
        status: newPendingReminders[0].status
      });
    }

    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testReminderSystem();
