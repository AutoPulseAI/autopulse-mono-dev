import { NextResponse } from 'next/server';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

export async function GET() {
  try {
    // Check environment variables
    const requiredEnvVars = [
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID', 
      'AWS_SECRET_ACCESS_KEY',
      'AWS_BUCKET_NAME'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'Missing required environment variables',
        missing: missingVars
      }, { status: 500 });
    }

    // Test S3 client connection
    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    // Try to list buckets to test connection
    const listCommand = new ListBucketsCommand({});
    const result = await s3Client.send(listCommand);

    return NextResponse.json({
      success: true,
      message: 'S3 connection successful',
      bucketName: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION,
      availableBuckets: result.Buckets?.map(b => b.Name) || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('S3 test error:', error);
    return NextResponse.json({
      success: false,
      error: 'S3 connection failed',
      details: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
