import dbConnect from "@lib/mongodb";
import { getToken } from "next-auth/jwt";
import User from "@models/User";
import jwt from "jsonwebtoken";
import { cookies } from 'next/headers';

export async function POST(req) {
  try {
    await dbConnect();
    
    // Verify admin is making this request
    

    const { userId } = await req.json();
    let currentUser = null;

    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      currentUser = await User.findById(decoded.userId).select('_id name email type');
      if (!currentUser) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    }else{
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
    
    // Find the dealer
    const user = await User.findById(userId).populate("role");
    if (!user ) {
      return new Response(JSON.stringify({ message: "Dealer not found" }), {
        status: 404,
      });
    }

    // Only a super admin (any account) or an agency (its own dealers) may sign in as someone else. Before this any
    // signed-in user could take over any account.
    const isAdmin = currentUser.type === 'admin';
    const isOwnAgency = currentUser.type === 'vendor' && String(user.vendor_id || '') === String(currentUser._id);
    if (!isAdmin && !isOwnAgency) {
      return new Response(JSON.stringify({ message: "Not allowed to sign in as this account" }), { status: 403 });
    }

    // Generate impersonation token (mark it as such): `impersonated_by` lets the CRM tell a super admin acting in a
    // dealer account from the dealer (app/lib/apiAuth.js loadSettingsEditor: only super admins edit AI settings).
    const token = jwt.sign(
      { 
        userId: user._id, 
        role: user?.role?.name, 
        type: user.type,
        impersonated_by: String(currentUser._id),
        impersonator_type: currentUser.type,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" } // Shorter expiration for impersonation
    );

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