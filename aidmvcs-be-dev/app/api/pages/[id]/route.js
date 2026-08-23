import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Page from "@models/Page";
import { requireAdmin } from "@lib/adminAuth";
import { normalizeSlug } from "@lib/pages";
import { normalizePuckData } from "@lib/puck/normalizeData";

export async function GET(request, { params }) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  await dbConnect();

  try {
    const { id } = await params;
    const page = await Page.findById(id).lean();
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }
    return NextResponse.json({
      ...page,
      content: normalizePuckData(page.content),
    });
  } catch (error) {
    console.error("Error fetching page:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  await dbConnect();

  try {
    const { id } = await params;
    const body = await request.json();
    const page = await Page.findById(id);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const {
      title,
      slug,
      status,
      showInNav,
      navOrder,
      navLabel,
      meta,
      content,
      pageType,
    } = body;

    if (title !== undefined) page.title = title;
    if (showInNav !== undefined) page.showInNav = showInNav;
    if (navOrder !== undefined) page.navOrder = navOrder;
    if (navLabel !== undefined) page.navLabel = navLabel;
    if (meta !== undefined) page.meta = meta;
    if (content !== undefined) {
      page.content = normalizePuckData(content);
      page.editor = "puck";
    }
    if (pageType !== undefined) page.pageType = pageType;

    if (slug !== undefined) {
      const normalizedSlug = normalizeSlug(slug);
      if (!normalizedSlug) {
        return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
      }
      const duplicate = await Page.findOne({ slug: normalizedSlug, _id: { $ne: id } });
      if (duplicate) {
        return NextResponse.json({ error: "A page with this slug already exists" }, { status: 400 });
      }
      page.slug = normalizedSlug;
    }

    if (status !== undefined) {
      page.status = status;
      if (status === "published" && !page.publishedAt) {
        page.publishedAt = new Date();
      }
    }

    await page.save();
    return NextResponse.json(page);
  } catch (error) {
    console.error("Error updating page:", error);
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  await dbConnect();

  try {
    const { id } = await params;
    const deleted = await Page.findByIdAndDelete(id);
    if (!deleted) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Page deleted successfully" });
  } catch (error) {
    console.error("Error deleting page:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
