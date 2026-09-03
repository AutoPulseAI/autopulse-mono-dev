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
    
    // Find the dealer
    const user = await User.findById(userId).populate("role");
    if (!user ) {
      return new Response(JSON.stringify({ message: "Dealer not found" }), {
        status: 404,
      });
    }

    // Generate impersonation token (mark it as such)
    const token = jwt.sign(
      { 
        userId: user._id, 
        role: user?.role?.name, 
        type: user.type,
       
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
      impersonatedBy: token.userId
    }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: 500,
    });
  }
}