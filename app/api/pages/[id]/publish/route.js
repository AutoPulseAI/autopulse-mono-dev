import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Page from "@models/Page";
import { requireAdmin } from "@lib/adminAuth";

export async function POST(request, { params }) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  await dbConnect();

  try {
    const { id } = await params;
    const page = await Page.findById(id);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    page.status = "published";
    page.publishedAt = new Date();
    await page.save();

    return NextResponse.json(page);
  } catch (error) {
    console.error("Error publishing page:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
