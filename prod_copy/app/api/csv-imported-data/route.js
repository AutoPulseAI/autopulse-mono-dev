// app/api/csv-imported-data/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import CSVImportedData from '@models/CSVImportedData';
import CSVImportData from '@models/CSVImportData';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const csvImportId = searchParams.get('csv_import_id');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 20;
    const skip = (page - 1) * limit;
    
    if (!csvImportId) {
      return NextResponse.json(
        { success: false, error: 'csv_import_id is required' },
        { status: 400 }
      );
    }
    
    // Get imported data with CSV info
    const importedData = await CSVImportedData.getWithCsvInfo(csvImportId, {
      status,
      limit,
      skip,
      sort: { record_index: 1 }
    });
    
    // Get total count
    const totalQuery = { csv_import_id: csvImportId };
    if (status) {
      totalQuery.import_status = status;
    }
    const total = await CSVImportedData.countDocuments(totalQuery);
    
    return NextResponse.json({
      success: true,
      data: importedData,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching CSV imported data:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    await dbConnect();
    
    const { action, csvImportId } = await request.json();
    
    if (action === 'get_stats' && csvImportId) {
      const stats = await CSVImportedData.getStatsByCsvImportId(csvImportId);
      return NextResponse.json({
        success: true,
        data: stats
      });
    }
    
    if (action === 'get_csv_info' && csvImportId) {
      const csvInfo = await CSVImportData.findById(csvImportId);
      if (!csvInfo) {
        return NextResponse.json(
          { success: false, error: 'CSV import not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        data: csvInfo
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('Error processing CSV imported data request:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
