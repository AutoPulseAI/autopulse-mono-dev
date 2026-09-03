import dbConnect from "@lib/mongodb";
import User from "@models/User";
import crypto from "crypto";
import { sendPasswordResetEmail } from "@lib/emailservice"; // You'll need to implement this

export async function POST(req) {
  try {
    await dbConnect();
    const { email, type } = await req.json();

    // Validate input
    if (!email || !type) {
      return new Response(
        JSON.stringify({ message: "Email and user type are required" }),
        { status: 400 }
      );
    }

    const emailNormalized = String(email).trim().toLowerCase();
    const typeNormalized = String(type).trim().toLowerCase();

    // Find user (email match is case-insensitive, same as /api/auth/login)
    const user = await User.findOne({
      $expr: { $eq: [{ $toLower: "$email" }, emailNormalized] },
      type: typeNormalized,
    });
    if (!user) {
      return new Response(
        JSON.stringify({ message: "This email does not exist" }),
        { status: 500 } // Don't reveal if user doesn't exist
      );
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpires = Date.now() + 3600000; // 1 hour from now

    // Save token to user
    user.resetToken = resetToken;
    user.resetTokenExpires = resetTokenExpires;
    await user.save();
    let user_type ="dealer";
    if(user.type=='vendor'){
      user_type='agency'
    }
    // Send email with reset link
    try {
      await sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetLink: `${process.env.NEXT_PUBLIC_BASE_URL}/${user_type}/reset?token=${resetToken}&email=${encodeURIComponent(user.email)}`
      });
    } catch (emailError) {
      console.error("Failed to send reset email:", emailError);
      // Continue even if email fails
    }

    return new Response(
      JSON.stringify({ message: "If this email exists, a reset link will be sent" }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Forgot password error:", error);
    return new Response(
      JSON.stringify({ message: "An error occurred. Please try again." }),
      { status: 500 }
    );
  }
}