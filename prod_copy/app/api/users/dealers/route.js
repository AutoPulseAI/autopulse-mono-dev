import User from "@models/User";
import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";

export async function GET(request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const vendor_id = searchParams.get('vendor_id');

    if (!vendor_id) {
      return NextResponse.json(
        { message: "Vendor ID is required" },
        { status: 400 }
      );
    }

    const dealers = await User.find(
      { vendor_id, type: "dealer" },
      { name: 1, email: 1, createdAt: 1 }
    ).lean();

    return NextResponse.json({ dealers });
  } catch (error) {
    console.error("Error fetching dealers:", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}