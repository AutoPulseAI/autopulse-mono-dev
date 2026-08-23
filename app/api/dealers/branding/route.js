// app/api/dealers/branding/route.js
import  dbConnect  from "@lib/mongodb";
import User from "@models/User";
//import { generatePresignedUrl, getObjectUrl } from "@lib/aws-s3";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export async function PUT(req) {
  try {
    await dbConnect();
    
    // Verify authentication token
   

    const { dealerId, branding_information } = await req.json();

    if (!dealerId) {
      return Response.json({ message: "Dealer ID is required" }, { status: 400 });
    }

    const dealer = await User.findById(dealerId);
    if (!dealer) {
      return Response.json({ message: "Dealer not found" }, { status: 404 });
    }

    // Update branding information
    dealer.branding_information = {
      ...dealer.branding_information,
      ...branding_information
    };

    await dealer.save();

    return Response.json(
      { 
        message: "Branding information updated successfully",
        branding_information: dealer.branding_information 
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating branding:", error);
    return Response.json(
      { message: "Error updating branding", error: error.message },
      { status: 500 }
    );
  }
}

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml"
];
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});


const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req) {
  try {
    const formData = await req.formData();
    const files = {
      dealershipLogo: formData.get("dealershipLogo"),
      bannerImage: formData.get("bannerImage"),
    };

    // Validate and upload files
    const uploadResults = {};
    
    for (const [fieldName, file] of Object.entries(files)) {
      if (!file) continue;

      // Validate file type
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        throw new Error(`Invalid file type for ${fieldName}`);
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large for ${fieldName} (max 5MB)`);
      }

      // Upload to S3 (without ACL)
      const key = `branding/${Date.now()}-${fieldName}-${file.name.replace(/\s+/g, '-')}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key,
          Body: Buffer.from(await file.arrayBuffer()),
          ContentType: file.type,
          // Removed ACL: "public-read" since bucket has ACLs disabled
        })
      );

      uploadResults[fieldName] = {
        key,
        url: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
      };
    }

    return Response.json({ success: true, ...uploadResults });

  } catch (error) {
    console.error("Upload error:", error);
    return Response.json(
      { error: error.message || "File upload failed" },
      { status: 500 }
    );
  }
}