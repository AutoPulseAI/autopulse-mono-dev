import dbConnect from "@lib/mongodb";
import User from "@models/User";
import Role from "@models/Role";
import Permission from "@models/Permission";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { sendRegistrationEmail } from "@lib/emailservice"; // Assuming you have an email service
import { normalizeUserEmail } from "@utils/userEmail";

export async function POST(req) {
  try {
    await dbConnect();
    const { name, email, password, type, phone, website, vendor_id = null } = await req.json();
    const emailNorm = normalizeUserEmail(email);

    // Validate required fields
    if (!name || !email || !password || !type) {
      return new Response(
        JSON.stringify({ message: "All fields are required." }), 
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm)) {
      return new Response(
        JSON.stringify({ message: "Please provide a valid email address." }), 
        { status: 400 }
      );
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: emailNorm });
    if (existingUser) {
      return new Response(
        JSON.stringify({ message: "Email already in use. Please use a different email." }), 
        { status: 409 }
      );
    }
    if(phone){
      const phoneExists = await User.findOne({ phone });
      const phoneRegex = /^[0-9]{10,15}$/;
      if (phoneExists) {
        return new Response(JSON.stringify({ message: "Phone number already in use by another vendor." }), { status: 400 });
      }
      if (!phoneRegex.test(phone)) {
        return new Response(
          JSON.stringify({ message: "Please provide a valid phone number (10-15 digits)." }), 
          { status: 400 }
        );
      }
    }

    // Validate website format if provided
    if (website) {
      const websiteRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
      if (!websiteRegex.test(website)) {
        return new Response(
          JSON.stringify({ message: "Please provide a valid website URL." }), 
          { status: 400 }
        );
      }
    }

    // Validate vendor_id if provided
    const validVendorId = vendor_id && mongoose.Types.ObjectId.isValid(vendor_id) 
      ? vendor_id 
      : null;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const newUser = new User({ 
      name, 
      email: emailNorm, 
      phone: phone || null, 
      website: website || null, 
      password: hashedPassword, 
      type,
      vendor_id: validVendorId 
    });
    
    await newUser.save();

    // Assign role based on user type


    const userRole = new Role({ name: "Admin", entity: type, entity_id: newUser._id });
    
    await userRole.save();

     
        
    const existingPermissions = await Permission.find({ entity: type });
          
    if (existingPermissions.length > 0) {
      userRole.permissions = existingPermissions.map((perm) => perm._id);
      await userRole.save();
    }

     if (!newUser.role_id) {
          await updateUserRole(newUser._id, userRole._id);
      }

    // Send registration email based on user type
    try {
      await sendRegistrationEmail({
        email: newUser.email,
        name: newUser.name,
        userType: newUser.type
      });
    } catch (emailError) {
      console.error("Failed to send registration email:", emailError);
      // Don't fail the request if email fails
    }

    return new Response(
      JSON.stringify({ 
        message: "User registered successfully", 
        user: newUser 
      }), 
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return new Response(
      JSON.stringify({ 
        message: error.message || "An error occurred during registration" 
      }), 
      { status: 500 }
    );
  }
}

async function  updateUserRole  (userId, roleId) {
  try {
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { role: roleId },
      { new: true }
    );
    return updatedUser;
  } catch (error) {
    console.error("Error updating user role:", error);
    throw error;
  }
};