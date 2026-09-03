import { NextResponse } from 'next/server';
import { processDealerCSVFiles } from '@lib/import';
import fs from 'fs';
import path from 'path';



export async function GET() {
  try {
    const uploadDir = path.join(process.cwd(), 'public', 'csv', 'upload');
    
    // Check if directory exists
    if (!fs.existsSync(uploadDir)) {
      return NextResponse.json(
        { message: 'Upload directory does not exist', filesProcessed: 0 },
        { status: 200 }
      );
    }

    // Read directory contents
    const files = fs.readdirSync(uploadDir);
    const csvFiles = files.filter(file => file.endsWith('.csv'));

    if (csvFiles.length === 0) {
      return NextResponse.json(
        { message: 'No CSV files found in upload directory', filesProcessed: 0 },
        { status: 200 }
      );
    }

    // Process each CSV file (using your dealer ID - you might need to adjust this)
    const dealerId = 'your-dealer-id-here'; // Replace with actual dealer ID or get from request
    const result = await processDealerCSVFiles();

    return NextResponse.json({
      message: 'CSV files processed successfully',
      filesFound: csvFiles.length,
      ...result
    });

  } catch (error) {
    console.error('Error processing CSV files:', error);
    return NextResponse.json(
      { error: 'Failed to process CSV files', details: error.message },
      { status: 500 }
    );
  }
}