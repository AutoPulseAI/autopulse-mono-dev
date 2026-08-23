import { NextResponse } from 'next/server';
import reminderCronService from '@lib/reminderCronService';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'status';

    switch (action) {
      case 'start':
        reminderCronService.start();
        return NextResponse.json({
          success: true,
          message: 'Reminder cron service started',
          status: reminderCronService.getStatus()
        });

      case 'stop':
        reminderCronService.stop();
        return NextResponse.json({
          success: true,
          message: 'Reminder cron service stopped',
          status: reminderCronService.getStatus()
        });

      case 'process':
        const result = await reminderCronService.processReminders();
        return NextResponse.json({
          success: true,
          message: 'Reminders processed manually',
          result: result,
          status: reminderCronService.getStatus()
        });

      case 'status':
      default:
        return NextResponse.json({
          success: true,
          message: 'Reminder cron service status',
          status: reminderCronService.getStatus()
        });
    }

  } catch (error) {
    console.error('Error in reminder cron service API:', error);
    return NextResponse.json({
      success: false,
      message: 'Error in reminder cron service',
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
        reminderCronService.start(intervalMinutes || 5);
        return NextResponse.json({
          success: true,
          message: 'Reminder cron service started',
          status: reminderCronService.getStatus()
        });

      case 'stop':
        reminderCronService.stop();
        return NextResponse.json({
          success: true,
          message: 'Reminder cron service stopped',
          status: reminderCronService.getStatus()
        });

      case 'process':
        const result = await reminderCronService.processReminders();
        return NextResponse.json({
          success: true,
          message: 'Reminders processed manually',
          result: result,
          status: reminderCronService.getStatus()
        });

      default:
        return NextResponse.json({
          success: false,
          message: 'Invalid action. Use: start, stop, or process'
        }, { status: 400 });
    }

  } catch (error) {
    console.error('Error in reminder cron service API:', error);
    return NextResponse.json({
      success: false,
      message: 'Error in reminder cron service',
      error: error.message
    }, { status: 500 });
  }
}
