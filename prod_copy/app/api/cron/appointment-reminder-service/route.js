import { NextResponse } from 'next/server';
import appointmentReminderCronService from '@lib/appointmentReminderCronService';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'status';

    switch (action) {
      case 'start':
        appointmentReminderCronService.start();
        return NextResponse.json({
          success: true,
          message: 'Appointment reminder cron service started',
          status: appointmentReminderCronService.getStatus()
        });

      case 'stop':
        appointmentReminderCronService.stop();
        return NextResponse.json({
          success: true,
          message: 'Appointment reminder cron service stopped',
          status: appointmentReminderCronService.getStatus()
        });

      case 'process':
        const result = await appointmentReminderCronService.processReminders();
        return NextResponse.json({
          success: true,
          message: 'Reminders processed manually',
          result: result,
          status: appointmentReminderCronService.getStatus()
        });

      case 'status':
      default:
        return NextResponse.json({
          success: true,
          message: 'Appointment reminder cron service status',
          status: appointmentReminderCronService.getStatus()
        });
    }

  } catch (error) {
    console.error('Error in appointment reminder cron service API:', error);
    return NextResponse.json({
      success: false,
      message: 'Error in appointment reminder cron service',
      error: error.message
    }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, intervalMinutes } = body;

    switch (action) {
      case 'start':
        appointmentReminderCronService.start(intervalMinutes || 5);
        return NextResponse.json({
          success: true,
          message: 'Appointment reminder cron service started',
          status: appointmentReminderCronService.getStatus()
        });

      case 'stop':
        appointmentReminderCronService.stop();
        return NextResponse.json({
          success: true,
          message: 'Appointment reminder cron service stopped',
          status: appointmentReminderCronService.getStatus()
        });

      case 'process':
        const result = await appointmentReminderCronService.processReminders();
        return NextResponse.json({
          success: true,
          message: 'Reminders processed manually',
          result: result,
          status: appointmentReminderCronService.getStatus()
        });

      default:
        return NextResponse.json({
          success: false,
          message: 'Invalid action. Use: start, stop, or process'
        }, { status: 400 });
    }

  } catch (error) {
    console.error('Error in appointment reminder cron service API:', error);
    return NextResponse.json({
      success: false,
      message: 'Error in appointment reminder cron service',
      error: error.message
    }, { status: 500 });
  }
}

