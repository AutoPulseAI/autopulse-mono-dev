import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import MenuItem, { MENU_LOCATIONS } from "@models/MenuItem";
import { requireAdmin } from "@lib/adminAuth";

export async function PUT(request, { params }) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const body = await request.json();

    await dbConnect();
    const item = await MenuItem.findById(id);
    if (!item) {
      return NextResponse.json({ error: "Menu item not found" }, { status: 404 });
    }

    if (body.label !== undefined) item.label = body.label;
    if (body.url !== undefined) item.url = body.url;
    if (body.order !== undefined) item.order = Number(body.order) || 0;
    if (body.visible !== undefined) item.visible = Boolean(body.visible);
    if (body.target !== undefined) item.target = body.target === "_blank" ? "_blank" : "_self";
    if (body.location !== undefined && MENU_LOCATIONS.includes(body.location)) item.location = body.location;

    await item.save();
    return NextResponse.json({ item });
  } catch (error) {
    console.error("Error updating menu item:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    await dbConnect();
    const item = await MenuItem.findByIdAndDelete(id);
    if (!item) {
      return NextResponse.json({ error: "Menu item not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting menu item:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
