import { NextResponse } from 'next/server';
import { uploadToS3 } from '@lib/aws-s3';

export async function POST(request) {
  try {
    const formData = await request.formData();
    // Support both 'images' (multiple) and 'file' (single) for different use cases
    let files = formData.getAll('images');
    if (files.length === 0) {
      const singleFile = formData.get('file');
      if (singleFile) {
        files = [singleFile];
      }
    }
    
    if (!files || files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No images provided' },
        { status: 400 }
      );
    }

    const uploadedImages = [];
    const errors = [];

    for (const file of files) {
      try {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          errors.push(`${file.name}: Not a valid image file`);
          continue;
        }

        // Validate file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
          errors.push(`${file.name}: File size exceeds 5MB limit`);
          continue;
        }

        // Convert file to buffer
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Generate unique filename
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 15);
        const fileExtension = file.name.split('.').pop();
        const type = formData.get('type') || 'support';
        const fileName = `${type}/${timestamp}_${randomId}.${fileExtension}`;

        // Upload to S3 with public access
        const publicUrl = await uploadToS3(buffer, fileName, file.type);

        uploadedImages.push({
          originalName: file.name,
          fileName: fileName,
          url: publicUrl,
          size: file.size,
          type: file.type,
          uploadedAt: new Date().toISOString()
        });

        console.log(`Successfully uploaded: ${file.name} to ${publicUrl}`);

      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        errors.push(`${file.name}: ${error.message}`);
      }
    }

    if (uploadedImages.length === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to upload any images',
          details: errors 
        },
        { status: 500 }
      );
    }

    // If single file upload, return single URL for convenience
    if (uploadedImages.length === 1) {
      return NextResponse.json({
        success: true,
        url: uploadedImages[0].url,
        filename: uploadedImages[0].fileName,
        size: uploadedImages[0].size,
        type: uploadedImages[0].type
      });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully uploaded ${uploadedImages.length} image(s)`,
      images: uploadedImages,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Image upload error:', error);
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
