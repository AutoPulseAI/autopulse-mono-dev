import dbConnect from "@lib/mongodb";
import User from "@models/User";
import bcrypt from "bcryptjs";
import { resetPasswordAccountEmail } from "@lib/emailservice";
import { requireSuperAdmin } from "@lib/apiGuard";

export async function POST(req) {
  try {
    await dbConnect();
    // Only a super admin sets another account's password (Admin > Agencies / Dealers > Change Password). This route
    // had no sign-in check and was used on 9 Nov 2026 to take over an account.
    const { response } = await requireSuperAdmin(req);
    if (response) return response;
    const { vendorId, password } = await req.json();

    // Validate input
    if (!vendorId || !password) {
      return new Response(JSON.stringify({ 
        message: "Vendor ID and password are required." 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ 
        message: "Password must be at least 8 characters long." 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find the vendor
    const vendor = await User.findById(vendorId);
    if (!vendor) {
      return new Response(JSON.stringify({ 
        message: "Vendor not found." 
      }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update the vendor's password
    vendor.password = hashedPassword;
    await vendor.save();

    // Send email notification
    await resetPasswordAccountEmail({
      email: vendor.email,
      name: vendor.name,
      password, // The plain text password (before hashing)
      type: 'vendor',
      createdBy: null,
      loginUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/agency`,
      isPasswordReset: true
    });

    return new Response(JSON.stringify({ 
      message: "Password reset successfully." 
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("Password reset error:", error);
    return new Response(JSON.stringify({ 
      message: error.message || "An error occurred while resetting the password." 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}