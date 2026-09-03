import { NextResponse } from "next/server";
import { listS3Objects } from "@lib/aws-s3";
import {
  CMS_MEDIA_PREFIX,
  getAdminFromRequest,
  toVvvebMediaPath,
} from "@lib/vvvebMedia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const objects = await listS3Objects(CMS_MEDIA_PREFIX);

    const items = objects
      .map((obj) => ({
        name: obj.key.split("/").pop() || obj.key,
        type: "file",
        path: toVvvebMediaPath(obj.key),
        size: obj.size,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      name: "",
      type: "folder",
      path: "",
      items,
    });
  } catch (error) {
    console.error("Vvveb media scan error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list media" },
      { status: 500 }
    );
  }
}
