import { NextResponse } from 'next/server';
import { processAllPendingReminders, getPendingReminders } from '@lib/appointmentReminderService';

/**
 * Cron endpoint to process all pending appointment reminders
 * GET /api/cron/appointment-reminders - Process all pending reminders
 * GET /api/cron/appointment-reminders?action=check - Check pending reminders without processing
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'check') {
      // Check pending reminders without processing
      const pendingReminders = await getPendingReminders();
      
      return NextResponse.json({
        success: true,
        message: 'Pending reminders checked',
        count: pendingReminders.length,
        reminders: pendingReminders.map(r => ({
          id: r._id,
          customer_name: r.customer_name,
          scheduled_for: r.scheduled_for,
          status: r.status,
          attempt_count: r.attempt_count
        }))
      });
    }

    // Default: Process all pending reminders
    console.log('🔄 Cron: Processing all pending appointment reminders...');
    const result = await processAllPendingReminders();
    
    return NextResponse.json({
      success: true,
      message: 'All pending appointment reminders processed',
      result: result
    });
    
  } catch (error) {
    console.error('Error in appointment reminders cron:', error);
    return NextResponse.json({
      success: false,
      message: 'Error processing appointment reminders',
      error: error.message
    }, { status: 500 });
  }
}

/**
 * Cron endpoint to process all pending appointment reminders
 * POST /api/cron/appointment-reminders - Process all pending reminders
 * POST /api/cron/appointment-reminders with { action: 'check' } - Check pending reminders without processing
 */
export async function POST(req) {
  try {
    let body = {};
    try {
      const text = await req.text();
      if (text.trim()) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // Empty body is fine, will default to processing
    }

    const { action } = body;

    if (action === 'check') {
      // Check pending reminders without processing
      const pendingReminders = await getPendingReminders();
      
      return NextResponse.json({
        success: true,
        message: 'Pending reminders checked',
        count: pendingReminders.length,
        reminders: pendingReminders.map(r => ({
          id: r._id,
          customer_name: r.customer_name,
          scheduled_for: r.scheduled_for,
          status: r.status,
          attempt_count: r.attempt_count
        }))
      });
    }

    // Default: Process all pending reminders
    console.log('🔄 Cron: Processing all pending appointment reminders...');
    const result = await processAllPendingReminders();
    
    return NextResponse.json({
      success: true,
      message: 'All pending appointment reminders processed',
      result: result
    });
    
  } catch (error) {
    console.error('Error in appointment reminders cron:', error);
    return NextResponse.json({
      success: false,
      message: 'Error processing appointment reminders',
      error: error.message
    }, { status: 500 });
  }
}
