import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import User from "@models/User";
import Permission from "@models/Permission";
import Role from "@models/Role";
import { requireDealerAccess } from "@lib/apiGuard";

// GET: Fetch staff members for a dealer (only those with Manage Leads or View Assigned Leads permissions)
export async function GET(req) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(req.url);
    const dealerId = searchParams.get("dealer_id");
    
    if (!dealerId) {
      return NextResponse.json(
        { error: "dealer_id is required" },
        { status: 400 }
      );
    }
    // Security fix (Nov 2026): any signed-in user could list any dealer's staff; now that dealer, its agency or a
    // super admin (and a bad token is a 401, not a 500).
    const guard = await requireDealerAccess(req, String(dealerId));
    if (guard.response) return guard.response;

    // Find all staff members where parent_id matches the dealer
    const allStaff = await User.find({
      parent_id: dealerId,
      type: "dealer" // Staff have same type as dealer
    })
      .select("_id name email role")
      .populate({
        path: "role",
        select: "name",
        populate: {
          path: "permissions",
          select: "permission_name"
        }
      })
      .lean();
    
    // Filter staff to only include those with "Manage Leads" or "View Assigned Leads" permissions
    const staff = allStaff.filter(user => {
      if (!user.role || !user.role.permissions) return false;
      const permissions = user.role.permissions.map(p => p.permission_name || p);
      return permissions.includes("Manage Leads") || permissions.includes("View Assigned Leads");
    });
    
    return NextResponse.json({ staff }, { status: 200 });
    
  } catch (error) {
    console.error("Error fetching staff:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

