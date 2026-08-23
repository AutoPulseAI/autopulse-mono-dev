import dbConnect from "@lib/mongodb";
import User from "@models/User";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sendOtpEmail } from "@lib/emailservice";

const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req) {
  try {
    await dbConnect();
    const { email, password, otp, type, rememberDevice } = await req.json();

    if (!email || !type) {
      return json({ message: "Email and type are required." }, 400);
    }

    const emailNormalized = String(email).trim().toLowerCase();
    const typeNormalized = String(type).trim().toLowerCase();

    // Email match is case-insensitive (local-part/domain casing should not block login).
    const user = await User.findOne({
      $expr: { $eq: [{ $toLower: "$email" }, emailNormalized] },
    });
    if (!user || user.type !== typeNormalized) {
      return json({ message: "Invalid credentials." }, 401);
    }

    // === CASE 1: OTP verification ===
    if (otp) {
      // Skip OTP verification for admin users
      if (typeNormalized === "admin") {
        const token = jwt.sign(
          { 
            userId: user._id, 
            role: user?.role?.name, 
            type: user.type,
            rememberDevice
          }, 
          process.env.JWT_SECRET, 
          { expiresIn: rememberDevice ? "60d" : "1d" }
        );

        const cookiename = `${user.type}token`;
        const cookieStore = await cookies();
        cookieStore.set({
          name: cookiename,
          value: token,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: rememberDevice ? 60 * 24 * 60 * 60 : 86400,
          path: "/",
        });

        return json({
          token,
          user: {
            _id: user._id,
            email: user.email,
            name: user.name,
            type: user.type,
            role: user.role
          }
        });
      }

      // Normal OTP verification for non-admin users
      if (!user.otp || user.otp !== otp || new Date() > new Date(user.otpExpiresAt)) {
        return json({ message: "Invalid or expired OTP." }, 401);
      }

      // Clear OTP after successful verification
      user.otp = null;
      user.otpExpiresAt = null;
      await user.save();

      const token = jwt.sign(
        { 
          userId: user._id, 
          role: user?.role?.name, 
          type: user.type,
          rememberDevice
        }, 
        process.env.JWT_SECRET, 
        { expiresIn: rememberDevice ? "60d" : "1d" }
      );
      const cookiename = `${user.type}token`;
      const cookieStore = await cookies();
      cookieStore.set({

      
        name: cookiename,
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: rememberDevice ? 60 * 24 * 60 * 60 : 86400,
        path: "/",
      });

      return json({
        token,
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          type: user.type,
          role: user.role
        }
      });
    }

    // === CASE 2: Password verification ===
    if (password) {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return json({ message: "Invalid password." }, 401);
      }

      // Skip OTP for admin users - issue token directly
      if (typeNormalized === "admin") {
        const token = jwt.sign(
          { 
            userId: user._id, 
            role: user?.role?.name, 
            type: user.type,
            rememberDevice
          }, 
          process.env.JWT_SECRET, 
          { expiresIn: rememberDevice ? "60d" : "1d" }
        );

        const cookiename = `${user.type}token`;
        const cookieStore = await cookies();
        cookieStore.set({
            name: cookiename,
            value: token,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: rememberDevice ? 60 * 24 * 60 * 60 : 86400,
            path: "/",
          });

        return json({
          token,
          user: {
            _id: user._id,
            email: user.email,
            name: user.name,
            type: user.type,
            role: user.role
          }
        });
      }

      // Generate OTP and send it for non-admin users
      const newOtp = generateOtp();
      user.otp = newOtp;
      user.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

      const updatedUser = await user.save({ new: true });
      
      if (!updatedUser.otp || !updatedUser.otpExpiresAt) {
        throw new Error("Failed to save OTP to database");
      } 

      await sendOtpEmail({
        email: user.email,
        name: user.name,
        otp: newOtp,
        userType: user.type,
        purpose: 'login'
      });

      return json({
        otp_sent: true,
        message: "OTP sent to your email.",
        otp: newOtp,
        rememberDevice
      });
    }

    // === CASE 3: Invalid request ===
    return json({ message: "Invalid request." }, 400);

  } catch (error) {
    console.error("Login Error:", error);
    return json({ message: error.message }, 500);
  }
}