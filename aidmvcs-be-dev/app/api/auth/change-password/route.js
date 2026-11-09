import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import User from "@models/User";
import { requestUsers, denied } from "@lib/apiGuard";
import bcrypt from "bcryptjs";

export async function PUT(req) {
  try {
    await dbConnect();
    const { userId, currentPassword, newPassword } = await req.json();
    // Only the signed-in user changes their own account; a super admin may change anyone's. These routes used to
    // trust the userId in the body (abused on 9 Nov 2026).
    const callers = await requestUsers(req);
    if (!callers.length) return denied(401);
    if (!callers.some((u) => String(u._id) === String(userId) || u.type === "admin")) return denied(403);

    const user = await User.findById(userId);
    if (!user) {
      return new Response(JSON.stringify({ message: "User not found" }), { status: 404 });
    }

    // Check if current password is correct
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return new Response(JSON.stringify({ message: "Current password is incorrect" }), { status: 400 });
    }

    // Hash new password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return new Response(JSON.stringify({ message: "Password changed successfully" }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}
