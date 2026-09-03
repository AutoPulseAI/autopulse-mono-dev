import dbConnect from "@lib/mongodb";
import User from "@models/User";
import bcrypt from "bcryptjs";

export async function POST(req) {
  try {
    await dbConnect();
    const { token, email, newPassword } = await req.json();

    // Validate input
    if (!token || !email || !newPassword) {
      return new Response(
        JSON.stringify({ message: "All fields are required" }),
        { status: 400 }
      );
    }

    const emailNormalized = String(email).trim().toLowerCase();

    // Find user by email (case-insensitive, same as login / forgot-password) and valid reset token
    const user = await User.findOne({
      $expr: { $eq: [{ $toLower: "$email" }, emailNormalized] },
      resetToken: token,
      resetTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return new Response(
        JSON.stringify({ message: "Invalid or expired token" }),
        { status: 400 }
      );
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password and clear reset token
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    return new Response(
      JSON.stringify({ message: "Password updated successfully" }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Reset password error:", error);
    return new Response(
      JSON.stringify({ message: "An error occurred. Please try again." }),
      { status: 500 }
    );
  }
}