import reportCronService, { LEGACY_REPORTS_DISABLED_MESSAGE } from '@lib/reportCronService';
import { requireCronCaller } from '@lib/apiGuard';
// Callers: the admin panel's cron buttons (super admin session) or the server's scheduler with CRON_SECRET.
// The old report sender is retired: start / check / process-overdue answer with a message pointing to the daily
// performance email (app/lib/reports/dailyReport.js, /api/admin/daily-report) and send nothing. The route stays so
// the admin page keeps working; stop, cleanup-orphaned and diagnose are unchanged.
const RETIRED_ACTIONS = new Set(['start', 'check', 'process-overdue']);

export async function GET(req) {
  const cronAuth = await requireCronCaller(req);
  if (cronAuth.response) return cronAuth.response;
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
  const cronAuth = await requireCronCaller(req);
  if (cronAuth.response) return cronAuth.response;
  try {
    const { action } = await req.json();

    if (RETIRED_ACTIONS.has(action)) {
      return new Response(JSON.stringify({
        success: true,
        disabled: true,
        sent: 0,
        message: LEGACY_REPORTS_DISABLED_MESSAGE
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
