import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Page from "@models/Page";
import { requireAdmin } from "@lib/adminAuth";
import { getEmptyPuckData, normalizeSlug } from "@lib/pages";
import { normalizePuckData } from "@lib/puck/normalizeData";
import { getBlankVvvebBody } from "@lib/vvvebStatic";

export async function GET(request) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  await dbConnect();
  const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page")) || 1;
    const limit = parseInt(searchParams.get("limit")) || 20;
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const editor = searchParams.get("editor");
    const skip = (page - 1) * limit;

  try {
    const query = {};
    if (status) query.status = status;
    if (editor) query.editor = editor;
    if (search) {
      const searchRegex = new RegExp(search.replace(/\s+/g, ".*"), "i");
      query.$or = [{ title: searchRegex }, { slug: searchRegex }];
    }

    const [pages, total] = await Promise.all([
      Page.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Page.countDocuments(query),
    ]);

    return NextResponse.json({
      pages,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Error fetching pages:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  await dbConnect();

  try {
    const body = await request.json();
    const {
      title,
      slug,
      status = "draft",
      showInNav = false,
      navOrder = 0,
      navLabel,
      meta = {},
      content,
      pageType = "marketing",
    } = body;

    if (!title || !slug) {
      return NextResponse.json({ error: "title and slug are required" }, { status: 400 });
    }

    const normalizedSlug = normalizeSlug(slug);
    if (!normalizedSlug) {
      return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    }

    const existing = await Page.findOne({ slug: normalizedSlug });
    if (existing) {
      return NextResponse.json({ error: "A page with this slug already exists" }, { status: 400 });
    }

    const newPage = new Page({
      title,
      slug: normalizedSlug,
      status,
      showInNav,
      navOrder,
      navLabel: navLabel || title,
      meta,
      content: normalizePuckData(content || getEmptyPuckData()),
      editor: "vvveb",
      html: getBlankVvvebBody(),
      pageType,
      publishedAt: status === "published" ? new Date() : undefined,
      createdBy: auth.decoded.userId,
    });

    await newPage.save();
    return NextResponse.json(newPage, { status: 201 });
  } catch (error) {
    console.error("Error creating page:", error);
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
  }
}
