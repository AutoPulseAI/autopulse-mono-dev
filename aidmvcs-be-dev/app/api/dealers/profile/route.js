import dbConnect from "@lib/mongodb";
import User from "@models/User";

import Role from "@models/Role";
import Permission from "@models/Permission";
import jwt from "jsonwebtoken";

export async function GET(req) {
  try {
    await dbConnect();

    //  Extract Token
    const userId = (new URL(req.url).searchParams.get("dealer_id"));
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
    

    //  Fetch User (Excluding Password) & Populate Role
    const user = await User.findById(userId)
          .select("-password")
          .populate({
            path: "role",
            populate: { path: "permissions" },
          })
          .populate({
            path: "current_subscription",
            populate: {
              path: "package_id",
              select: "name price duration max_dealers features"
            }
          })
          .populate({
            path: "parent_id",
            select: "name email"
          });
    
        if (!user) {
          return new Response(
            JSON.stringify({ message: "User not found" }),
            { status: 404 }
          );
        }
    
        // Extract permissions
        const permissions = user.role?.permissions?.map((p) => p.permission_name) || [];
    
        // Prepare subscription data
        let subscriptionData = null;
        if (user.current_subscription) {
          subscriptionData = {
            id: user.current_subscription._id,
            package: {
              id: user.current_subscription.package_id._id,
              name: user.current_subscription.package_id.name,
              price: user.current_subscription.package_id.price,
              duration: user.current_subscription.package_id.duration,
              max_dealers: user.current_subscription.package_id.max_dealers,
              features: user.current_subscription.package_id.features || []
            },
            status: user.current_subscription.status,
            start_date: user.current_subscription.start_date,
            end_date: user.current_subscription.end_date,
            is_manual: user.current_subscription.is_manual || false
          };
        }
    
        // Prepare parent data if exists
        const parentData = user.parent_id ? {
          id: user.parent_id._id,
          name: user.parent_id.name,
          email: user.parent_id.email
        } : null;
    
        return new Response(
          JSON.stringify({
            id: user._id,
            name: user.name,
            email: user.email,
            type: user.type,
            role: user.role?.name || "Guest",
            permissions,
            subscription: subscriptionData,
            parent: parentData,
            vendor_id:user.vendor_id||null,
            dealer_account_information: user.dealer_account_information || null,
            setting: user.setting || null,
            package_expiry: user.package_expiry,
            package_dealers_allowed: user.package_dealers_allowed || 0,
            package_dealers_used: user.package_dealers_used || 0
          }),
          { status: 200 }
        );
      } catch (error) {
        console.error("Error in /api/auth/me:", error);
        return new Response(
          JSON.stringify({ message: "Server error" }),
          { status: 500 }
        );
      }
}
