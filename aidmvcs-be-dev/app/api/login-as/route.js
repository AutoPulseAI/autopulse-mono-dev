import dbConnect from "@lib/mongodb";
import { getToken } from "next-auth/jwt";
import User from "@models/User";
import jwt from "jsonwebtoken";
import { cookies } from 'next/headers';
import { mayViewAs } from "@lib/viewAs";

export async function POST(req) {
  try {
    await dbConnect();
    
    // Verify admin is making this request
    

    const { userId } = await req.json();
    let currentUser = null;

    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
      currentUser = await User.findById(decoded.userId).select('_id name email type parent_id role')
        .populate({ path: 'role', populate: { path: 'permissions' } });
      if (!currentUser) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    }else{
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
    
    // Find the dealer
    // Never send back the password hash, sign-in code or reset token.
    const user = await User.findById(userId).select("-password -otp -otpExpiresAt -otpAttempts -resetToken -resetTokenExpires").populate("role");
    if (!user ) {
      return new Response(JSON.stringify({ message: "Dealer not found" }), {
        status: 404,
      });
    }

    // Only a super admin (any account) or an agency (its own dealers) may sign in as someone else. Before this any
    // signed-in user could take over any account.
    const isAdmin = currentUser.type === 'admin';
    const isOwnAgency = currentUser.type === 'vendor' && String(user.vendor_id || '') === String(currentUser._id);
    // "View as" (app/lib/viewAs.js): the dealership or its employee managers, as one of their own staff, look-only.
    const viewerPerms = (currentUser.role?.permissions || []).map((p) => p?.permission_name);
    const viewAs = !isAdmin && !isOwnAgency && mayViewAs(currentUser, user, viewerPerms);
    if (!isAdmin && !isOwnAgency && !viewAs) {
      return new Response(JSON.stringify({ message: "Not allowed to sign in as this account" }), { status: 403 });
    }

    // Generate impersonation token (mark it as such): `impersonated_by` lets the CRM tell a super admin acting in a
    // dealer account from the dealer (app/lib/apiAuth.js loadSettingsEditor: only super admins edit AI settings).
    const token = jwt.sign(
      { 
        userId: user._id, 
        role: user?.role?.name, 
        type: user.type,
        // "View as" is not "login as": no impersonated_by (which skips the IP restriction and lets a super admin
        // edit), only view_as, which makes the session look-only (middleware.js).
        ...(viewAs
          ? { view_as: true, viewed_by: String(currentUser._id), viewer_name: currentUser.name || null }
          : { impersonated_by: String(currentUser._id), impersonator_type: currentUser.type }),
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" } // Shorter expiration for impersonation
    );

    // "View as" keeps the viewer's own sign-in cookie: the view lives only in this browser tab's token.
    if (viewAs) {
      return new Response(JSON.stringify({ token, view_as: true, user: { _id: user._id, name: user.name } }), { status: 200 });
    }

    // Set cookie
    const cookiename= user.type+'token';
    const cookieStore = await cookies();
    cookieStore.set({
      name: cookiename,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600, // 1 hour
      path: '/',
    });

    return new Response(JSON.stringify({ 
      token, 
      user: user,
      impersonatedBy: String(currentUser._id)
    }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: 500,
    });
  }
}