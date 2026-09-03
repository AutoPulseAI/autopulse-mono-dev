import reportCronService from '@lib/reportCronService';

export async function GET() {
  try {
    // Get service status
    const status = reportCronService.getStatus();
    
    return new Response(JSON.stringify({
      success: true,
      status
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error('Error getting cron service status:', error);
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
      reportCronService.start();
      return new Response(JSON.stringify({
        success: true,
        message: 'Report cron service started successfully'
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (action === 'stop') {
      reportCronService.stop();
      return new Response(JSON.stringify({
        success: true,
        message: 'Report cron service stopped successfully'
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (action === 'check') {
      await reportCronService.manualCheck();
      return new Response(JSON.stringify({
        success: true,
        message: 'Manual report check completed'
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (action === 'process-overdue') {
      await reportCronService.processOverdueReports();
      return new Response(JSON.stringify({
        success: true,
        message: 'Overdue report processing completed'
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (action === 'cleanup-orphaned') {
      const { cleanupOrphanedReports } = await import('@utils/reportScheduler');
      const result = await cleanupOrphanedReports();
      return new Response(JSON.stringify({
        success: true,
        message: 'Orphaned reports cleanup completed',
        result: result
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (action === 'diagnose') {
      const { reportId } = await req.json();
      if (!reportId) {
        return new Response(JSON.stringify({
          success: false,
          message: 'reportId is required for diagnose action'
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const { diagnoseReportSchedule } = await import('@utils/reportScheduler');
      const result = await diagnoseReportSchedule(reportId);
      return new Response(JSON.stringify({
        success: true,
        message: 'Report diagnosis completed',
        result: result
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid action. Use: start, stop, check, process-overdue, cleanup-orphaned, or diagnose'
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error('Error controlling cron service:', error);
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
