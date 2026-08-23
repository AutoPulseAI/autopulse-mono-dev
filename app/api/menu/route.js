import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import MenuItem, { MENU_LOCATIONS } from "@models/MenuItem";
import { requireAdmin } from "@lib/adminAuth";

// Public: navigation items.
// ?location=header (default) or comma-separated list e.g. ?location=footer,footer2,legal
// Admins can pass ?all=1 to get every item (including hidden) across all locations.
export async function GET(request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const wantsAll = searchParams.get("all") === "1";
    const isAdmin = wantsAll && !requireAdmin(request).error;

    await dbConnect();

    let query;
    if (isAdmin) {
      query = {};
    } else {
      const locations = (searchParams.get("location") || "header")
        .split(",")
        .map((l) => l.trim())
        .filter((l) => MENU_LOCATIONS.includes(l));
      query = { visible: true, location: { $in: locations.length ? locations : ["header"] } };
    }

    const items = await MenuItem.find(query)
      .sort({ location: 1, order: 1, createdAt: 1 })
      .lean();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error fetching menu:", error);
    return NextResponse.json({ items: [] }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { label, url, order, visible, target, location } = body;
    if (!label || !url) {
      return NextResponse.json({ error: "label and url are required" }, { status: 400 });
    }

    const itemLocation = MENU_LOCATIONS.includes(location) ? location : "header";

    await dbConnect();
    let itemOrder = order;
    if (itemOrder === undefined || itemOrder === null || itemOrder === "") {
      const last = await MenuItem.findOne({ location: itemLocation }).sort({ order: -1 }).lean();
      itemOrder = last ? last.order + 1 : 0;
    }

    const item = await MenuItem.create({
      label,
      url,
      order: itemOrder,
      visible: visible !== false,
      target: target === "_blank" ? "_blank" : "_self",
      location: itemLocation,
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error("Error creating menu item:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
