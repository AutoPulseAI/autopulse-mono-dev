// app/api/csv-data/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import CSVImportData from '@models/CSVImportData';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 20;
    const status = searchParams.get('status');
    const dealerId = searchParams.get('dealer_id');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    
    // Build query
    const query = {};
    
    if (status) {
      query.processing_status = status;
    }
    
    if (dealerId) {
      query.dealer_id = dealerId;
    }
    
    if (dateFrom || dateTo) {
      query.created_at = {};
      if (dateFrom) {
        query.created_at.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        query.created_at.$lte = new Date(dateTo);
      }
    }
    
    // Get total count
    const total = await CSVImportData.countDocuments(query);
    
    // Get paginated results
    const csvData = await CSVImportData.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    
    return NextResponse.json({
      success: true,
      data: csvData,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching CSV data:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    await dbConnect();
    
    const { action, csvDataId } = await request.json();
    
    if (action === 'get_stats') {
      const stats = await CSVImportData.getProcessingStats();
      return NextResponse.json({
        success: true,
        data: stats
      });
    }
    
    if (action === 'get_recent_history') {
      const { limit = 50, dealer_id } = await request.json();
      const history = await CSVImportData.getRecentHistory(limit, dealer_id);
      return NextResponse.json({
        success: true,
        data: history
      });
    }
    
    if (action === 'get_details' && csvDataId) {
      const csvData = await CSVImportData.findById(csvDataId);
      
      if (!csvData) {
        return NextResponse.json(
          { success: false, error: 'CSV data not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        data: csvData
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('Error processing CSV data request:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
