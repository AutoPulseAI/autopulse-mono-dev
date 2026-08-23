import { generateReportSubject } from '../../../lib/reportGenerator.js';

export async function GET(request) {
  try {
    const frequencies = ['daily', 'weekly', 'monthly', 'yearly'];
    const results = {};
    
    for (const frequency of frequencies) {
      // Create a mock period for testing
      const now = new Date();
      let startDate, endDate;
      
      switch (frequency) {
        case 'daily':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          break;
        case 'weekly':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          break;
        case 'monthly':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          break;
        case 'yearly':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 365);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          break;
      }
      
      const period = { startDate, endDate, type: frequency };
      const subject = generateReportSubject(frequency, period);
      
      results[frequency] = {
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          type: frequency
        },
        subject: subject
      };
    }
    
    return Response.json({
      success: true,
      message: 'Frequency-specific email subjects generated',
      data: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error testing email subjects:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
