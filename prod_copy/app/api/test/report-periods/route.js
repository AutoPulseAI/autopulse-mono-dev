import { getReportPeriod, getPreviousPeriod } from '../../../lib/reportGenerator.js';

export async function GET(request) {
  try {
    const frequencies = ['daily', 'weekly', 'monthly', 'yearly'];
    const results = {};
    
    for (const frequency of frequencies) {
      const currentPeriod = getReportPeriod(frequency);
      const previousPeriod = getPreviousPeriod(currentPeriod);
      
      results[frequency] = {
        current: {
          startDate: currentPeriod.startDate.toISOString(),
          endDate: currentPeriod.endDate.toISOString(),
          type: currentPeriod.type,
          daysCovered: Math.ceil((currentPeriod.endDate - currentPeriod.startDate) / (1000 * 60 * 60 * 24))
        },
        previous: {
          startDate: previousPeriod.startDate.toISOString(),
          endDate: previousPeriod.endDate.toISOString(),
          daysCovered: Math.ceil((previousPeriod.endDate - previousPeriod.startDate) / (1000 * 60 * 60 * 24))
        }
      };
    }
    
    return Response.json({
      success: true,
      message: 'Frequency-specific report periods calculated',
      data: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error testing report periods:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
