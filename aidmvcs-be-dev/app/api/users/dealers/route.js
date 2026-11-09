import User from "@models/User";
import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import { requireAgencyAccess } from "@lib/apiGuard";

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
    // Security fix (Nov 2026): an agency's own dealer list (or a super admin); this listed any agency's dealers.
    const guard = await requireAgencyAccess(request, vendor_id);
    if (guard.response) return guard.response;

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