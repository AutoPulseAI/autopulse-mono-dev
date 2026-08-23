import ReportSchedule from '../../../models/ReportSchedule.js';
import dbConnect from '../../../lib/mongodb.js';

export async function GET(request) {
  try {
    await dbConnect();
    
    // Get all ReportSchedule entries
    const allReports = await ReportSchedule.find({}).populate('dealer_id', 'name email');
    
    // Group by status
    const statusCounts = {};
    allReports.forEach(report => {
      statusCounts[report.status] = (statusCounts[report.status] || 0) + 1;
    });
    
    // Get recent reports
    const recentReports = await ReportSchedule.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('dealer_id', 'name email');
    
    return Response.json({
      success: true,
      message: 'ReportSchedule database status',
      data: {
        totalReports: allReports.length,
        statusCounts,
        recentReports: recentReports.map(report => ({
          _id: report._id,
          dealer_id: report.dealer_id?._id,
          dealerName: report.dealer_id?.name,
          schedule_id: report.schedule_id,
          frequency: report.frequency,
          scheduledAt: report.scheduledAt,
          sentAt: report.sentAt,
          status: report.status,
          createdAt: report.createdAt
        }))
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error testing ReportSchedule database:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
