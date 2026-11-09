import { NextResponse } from 'next/server';
import { uploadToS3 } from '@lib/aws-s3';
import { requireUser } from '@lib/apiGuard';

export async function POST(request) {
  // Security fix (Nov 2026): anyone could put files in our public S3 bucket. Only signed-in users (campaign attachments).
  const guard = await requireUser(request);
  if (guard.response) return guard.response;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file size (10MB limit for attachments)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'File size exceeds 10MB limit' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const fileExtension = file.name.split('.').pop();
    const type = formData.get('type') || 'campaign-attachment';
    const fileName = `${type}/${timestamp}_${randomId}.${fileExtension}`;

    // Upload to S3 with public access
    const publicUrl = await uploadToS3(buffer, fileName, file.type);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename: file.name,
      size: file.size,
      type: file.type
    });

  } catch (error) {
    console.error('File upload error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

