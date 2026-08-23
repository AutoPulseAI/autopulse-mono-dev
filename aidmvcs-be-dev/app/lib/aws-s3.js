import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  // Optional: Configure retry logic
  maxAttempts: 3,
  retryMode: "standard"
});

/**
 * Generates a presigned URL for direct S3 uploads
 * @param {string} key - The S3 object key/path
 * @param {string} contentType - The MIME type of the file
 * @returns {Promise<string>} Presigned URL
 */
export async function generatePresignedUrl(key, contentType) {
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
     
      Metadata: {
        "uploaded-by": "branding-form"
      }
    });
  
    return await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
      signingDate: new Date(),
      signableHeaders: new Set(['x-amz-acl']) // Explicitly sign this header
    });
  }

/**
 * Gets the public URL for an S3 object
 * @param {string} key - The S3 object key
 * @returns {string} Public URL
 */
export function getObjectUrl(key) {
  if (!key) return null;
  
  // Use the virtual-hosted–style URL
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}`;
}

/**
 * Validates an S3 key exists (optional helper)
 */
export async function validateS3Key(key) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key
    }));
    return true;
  } catch (error) {
    if (error.name === "NotFound") return false;
    throw error;
  }
}

/**
 * Uploads a file to S3 and returns the public URL
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} fileName - The name/path for the file in S3
 * @param {string} contentType - The MIME type of the file
 * @returns {Promise<string>} Public URL of the uploaded file
 */
export async function uploadToS3(fileBuffer, fileName, contentType) {
  try {
    // Validate inputs
    if (!fileBuffer || !fileName || !contentType) {
      throw new Error('Missing required parameters: fileBuffer, fileName, or contentType');
    }

    if (!process.env.AWS_BUCKET_NAME) {
      throw new Error('AWS_BUCKET_NAME environment variable is not set');
    }

    console.log(`Starting S3 upload: ${fileName} (${fileBuffer.length} bytes, ${contentType})`);

    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName,
      Body: fileBuffer,
      ContentType: contentType,
     
      CacheControl: "public, max-age=31536000", // Cache for 1 year
      Metadata: {
        "uploaded-by": "support-system",
        "uploaded-at": new Date().toISOString(),
        "original-size": fileBuffer.length.toString()
      }
    });

    console.log(`Uploading to bucket: ${process.env.AWS_BUCKET_NAME}, region: ${process.env.AWS_REGION}`);

    await s3Client.send(uploadCommand);
    
    const publicUrl = getPublicUrl(fileName);
    console.log(`S3 upload successful: ${fileName} -> ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    console.error('Upload details:', {
      fileName,
      contentType,
      fileSize: fileBuffer?.length,
      bucket: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION
    });
    throw error;
  }
}

/**
 * Gets the public URL for an S3 object
 * @param {string} fileName - The S3 object key/path
 * @returns {string} Public URL
 */
export function getPublicUrl(fileName) {
  if (!fileName) return null;
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodeURIComponent(fileName).replace(/%2F/g, "/")}`;
}

/**
 * List objects under an S3 prefix (non-recursive, flat file list).
 * @param {string} prefix - e.g. "cms-media/"
 * @returns {Promise<Array<{ key: string, size: number, lastModified?: Date }>>}
 */
export async function listS3Objects(prefix) {
  if (!process.env.AWS_BUCKET_NAME) {
    throw new Error("AWS_BUCKET_NAME environment variable is not set");
  }

  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const items = [];
  let continuationToken;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.AWS_BUCKET_NAME,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents || []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue;
      items.push({
        key: obj.Key,
        size: obj.Size || 0,
        lastModified: obj.LastModified,
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return items;
}

/**
 * Processes and uploads media from Twilio to S3
 * @param {Object} mediaItem - Twilio media item
 * @param {string} messageId - Message ID
 * @param {string} dealerId - Dealer ID
 * @returns {Promise<Object>} Upload result with public URL
 */
export async function processAndUploadMedia(mediaItem, messageId, dealerId) {
  try {
    // Validate inputs
    if (!mediaItem?.url || !messageId || !dealerId) {
      throw new Error('Missing required parameters for media processing');
    }

    const response = await fetch(mediaItem.url, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64')}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(buffer);
    const fileExtension = mediaItem.contentType?.split('/')[1] || 'bin';
    const fileName = `media/${dealerId}/${messageId}/${Date.now()}.${fileExtension}`;

    // Upload to S3
    const publicUrl = await uploadToS3(fileBuffer, fileName, mediaItem.contentType);

    const result = {
      originalUrl: mediaItem.url,
      publicUrl,
      contentType: mediaItem.contentType,
      fileName,
      size: fileBuffer.length,
      uploadedAt: new Date().toISOString(), // Convert to ISO string for consistent formatting
      status: 'processed'
    };

    console.log('Media processed successfully:', result);
    return result;

  } catch (error) {
    console.error('Error processing media:', error);
    return {
      originalUrl: mediaItem?.url,
      error: error.message,
      status: 'failed',
      uploadedAt: new Date().toISOString(), // Convert to ISO string for consistent formatting
    };
  }
}

/**
 * Generates a temporary signed URL for private files
 * @param {string} fileName - The S3 object key/path
 * @returns {Promise<string>} Signed URL that expires
 */
export async function getSignedFileUrl(fileName) {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName
    });
    
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}
