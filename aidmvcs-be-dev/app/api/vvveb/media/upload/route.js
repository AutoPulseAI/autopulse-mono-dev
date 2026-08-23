import { NextResponse } from "next/server";
import { uploadToS3 } from "@lib/aws-s3";
import {
  CMS_MEDIA_PREFIX,
  getAdminFromRequest,
  sanitizeUploadFilename,
  toVvvebMediaPath,
  validateMediaFile,
} from "@lib/vvvebMedia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const admin = getAdminFromRequest(request);
  if (!admin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    const validationError = validateMediaFile(file);
    if (validationError) {
      return new NextResponse(validationError, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const safeName = sanitizeUploadFilename(file.name);
    const s3Key = `${CMS_MEDIA_PREFIX}/${safeName}`;

    await uploadToS3(buffer, s3Key, file.type || "application/octet-stream");

    // Vvveb expects plain-text filename/path (same as upload.php)
    const vvvebPath = toVvvebMediaPath(s3Key);
    return new NextResponse(vvvebPath.replace(/^\//, ""), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("Vvveb media upload error:", error);
    return new NextResponse(error.message || "Upload failed", { status: 500 });
  }
}
