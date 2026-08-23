import { NextResponse } from "next/server";
import { getPageBySlug } from "@lib/pages";
import { verifyToken } from "@lib/auth";

export async function GET(request, { params }) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const preview = searchParams.get("preview") === "true";
    let includeDraft = false;

    if (preview) {
      const token = request.headers.get("authorization")?.replace("Bearer ", "");
      const decoded = token ? verifyToken(token) : null;
      if (decoded?.type === "admin") {
        includeDraft = true;
      }
    }

    const page = await getPageBySlug(slug, { includeDraft });
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json(page);
  } catch (error) {
    console.error("Error fetching page by slug:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
