import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import User from "@models/User";
import Permission from "@models/Permission";
import Role from "@models/Role";
import jwt from "jsonwebtoken";

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
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const currentUser = await User.findById(decoded.userId).select('_id name email type');
      if (currentUser) {
        const userPermissions = currentUser?.role?.permissions?.map(p => p.permission_name) || [];
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    }else{
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
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

