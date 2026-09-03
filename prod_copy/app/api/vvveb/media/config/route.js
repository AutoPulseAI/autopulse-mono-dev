import { NextResponse } from "next/server";
import { getAdminFromRequest, getCmsMediaBaseUrl } from "@lib/vvvebMedia";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    mediaPath: getCmsMediaBaseUrl(),
    uploadUrl: "/api/vvveb/media/upload",
    scanUrl: "/api/vvveb/media/scan",
  });
}
