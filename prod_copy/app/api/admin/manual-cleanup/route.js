import { cleanupOldReports, cleanupFutureReports, getScheduleStatusSummary } from '../../../utils/reportScheduler.js';
import dbConnect from '../../../lib/mongodb.js';
import ReportSchedule from '../../../models/ReportSchedule.js';

export async function POST(request) {
  try {
    await dbConnect();
    
    const { action, dryRun = false } = await request.json();
    
    if (!action) {
      return Response.json({
        success: false,
        error: 'Action parameter is required'
      }, { status: 400 });
    }
    
    let result = {};
    
    switch (action) {
      case 'cleanup-old':
        if (dryRun) {
          // Dry run: just show what would be cleaned up
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          
          const oldReports = await ReportSchedule.find({
            status: 'sent',
            sentAt: { $lt: ninetyDaysAgo }
          }).populate('dealer_id', 'name email');
          
          result = {
            action: 'cleanup-old',
            dryRun: true,
            reportsFound: oldReports.length,
            reports: oldReports.map(r => ({
              id: r._id,
              dealer: r.dealer_id?.name || 'Unknown',
              sentAt: r.sentAt,
              daysOld: Math.floor((new Date() - r.sentAt) / (1000 * 60 * 60 * 24))
            }))
          };
        } else {
          // Actually perform cleanup
          await cleanupOldReports();
          result = { action: 'cleanup-old', completed: true };
        }
        break;
        
      case 'cleanup-future':
        if (dryRun) {
          // Dry run: show what would be cleaned up
          const now = new Date();
          const futureReports = await ReportSchedule.find({
            status: 'pending',
            scheduledAt: { $gt: now }
          }).populate('dealer_id', 'name email');
          
          result = {
            action: 'cleanup-future',
            dryRun: true,
            reportsFound: futureReports.length,
            reports: futureReports.map(r => ({
              id: r._id,
              dealer: r.dealer_id?.name || 'Unknown',
              scheduledAt: r.scheduledAt,
              daysUntilScheduled: Math.ceil((r.scheduledAt - now) / (1000 * 60 * 60 * 24))
            }))
          };
        } else {
          // Actually perform cleanup
          await cleanupFutureReports();
          result = { action: 'cleanup-future', completed: true };
        }
        break;
        
      case 'status':
        const summary = await getScheduleStatusSummary();
        result = { action: 'status', summary };
        break;
        
      default:
        return Response.json({
          success: false,
          error: `Unknown action: ${action}. Valid actions: cleanup-old, cleanup-future, status`
        }, { status: 400 });
    }
    
    return Response.json({
      success: true,
      message: `Manual cleanup action '${action}' completed`,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in manual cleanup:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    await dbConnect();
    
    // Get current status
    const summary = await getScheduleStatusSummary();
    
    return Response.json({
      success: true,
      message: 'Manual cleanup endpoint status',
      data: {
        summary,
        availableActions: [
          'cleanup-old - Clean up old sent reports (90+ days)',
          'cleanup-future - Fix/reschedule future-dated reports',
          'status - Get current status summary'
        ],
        usage: {
          method: 'POST',
          body: '{ "action": "action-name", "dryRun": true/false }'
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting manual cleanup status:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
