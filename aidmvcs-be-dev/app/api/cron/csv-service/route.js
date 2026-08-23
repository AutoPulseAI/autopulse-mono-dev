// app/api/cron/csv-service/route.js
import csvCronService from '@lib/csvCronService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const status = csvCronService.getStatus();
    
    return new Response(JSON.stringify({
      success: true,
      data: status
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error('Error getting CSV cron service status:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Error getting service status',
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req) {
  try {
    const { action } = await req.json();
    
    if (action === 'start') {
      csvCronService.start();
      return new Response(JSON.stringify({
        success: true,
        message: 'CSV processing cron service started successfully'
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (action === 'stop') {
      csvCronService.stop();
      return new Response(JSON.stringify({
        success: true,
        message: 'CSV processing cron service stopped successfully'
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (action === 'check') {
      const result = await csvCronService.manualCheck();
      return new Response(JSON.stringify({
        success: true,
        message: 'Manual CSV file check completed',
        data: result
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid action. Use: start, stop, or check'
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error('Error controlling CSV cron service:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Error controlling service',
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
