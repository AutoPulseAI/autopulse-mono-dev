import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import User from "@models/User";
import bcrypt from "bcryptjs";

export async function PUT(req) {
  try {
    await dbConnect();
    const { userId, currentPassword, newPassword } = await req.json();

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
