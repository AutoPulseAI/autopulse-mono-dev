import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import User from "@models/User";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import Role from "@models/Role";
import bcrypt from "bcryptjs";
import Permission from "@models/Permission";
import { sendStaffAccountEmail, resetPasswordAccountEmail } from "@lib/emailservice";
import { normalizeUserEmail } from "@utils/userEmail";
import { parseWorkSchedule } from "@lib/workSchedule";

export async function GET(req) {
  try {
    await dbConnect();
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'admin';
    const parent_id = url.searchParams.get('parent_id') || '';
    const page = parseInt(url.searchParams.get("page")) || 1;
    const name = url.searchParams.get("name") || '';
    const email = url.searchParams.get("email") || '';
    const role = url.searchParams.get("role") || '';
    const limit = 10;
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
    // Build the base query
    let query = { type: type };
    
    if (parent_id && type !== 'admin') {
      query.parent_id = parent_id;
    }

    // Add search filters if provided
    if (name) {
      query.name = { $regex: name, $options: 'i' }; // Case-insensitive search
    }
    if (email) {
      query.email = { $regex: email, $options: 'i' };
    }
    if (role) {
      query.role = role;
    }

    const totalStaff = await User.countDocuments(query);
    const totalPages = Math.ceil(totalStaff / limit);

    const staff = await User.find(query)
      .populate("role", "name")
      .select("email role name work_schedule")
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    if (!staff || staff.length === 0) {
      return new Response(JSON.stringify({ staff: [], totalPages }), { status: 200 });
    }

    return new Response(JSON.stringify({ staff, totalPages }), { status: 200 });

  } catch (error) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

export async function POST(req) {
  try {
    await dbConnect();
    const { name, email, password, role, type,parent_id, work_schedule } = await req.json();
    const emailNorm = normalizeUserEmail(email);
    // Staff work schedule (app/lib/workSchedule.js); unset = the dealership's opening hours.
    const schedule = work_schedule === undefined ? { value: undefined } : parseWorkSchedule(work_schedule);
    if (schedule.error) return Response.json({ message: schedule.error }, { status: 422 });

    // Check if email already exists (stored canonical lowercase)
    const existingUser = await User.findOne({ email: emailNorm });
    if (existingUser) {
      return Response.json(
        { message: "Email already exists. Please use a different email." },
        { status: 400 }
      );
    }
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
    const hashedPassword = await bcrypt.hash(password, 10); 
    // Create a new user
    const newStaff = new User({ name, email: emailNorm, password:hashedPassword, role, type,parent_id:parent_id||null,
      ...(schedule.value ? { work_schedule: schedule.value } : {}) });
    await newStaff.save();

    // Populate role details
    const updatedStaff = await User.findById(newStaff._id).populate("role", "name");

    // Send email with credentials
    let loginurl = `${process.env.NEXT_PUBLIC_BASE_URL}`;
    if(type==='vendor'){
      loginurl=`${process.env.NEXT_PUBLIC_BASE_URL}/agency`;
    }else{
      loginurl=`${process.env.NEXT_PUBLIC_BASE_URL}/${type}`;
    }
    const parentUser = parent_id ? await User.findById(parent_id).select('name email phone website') : null;
    await sendStaffAccountEmail({
      email: emailNorm,
      name,
      password, // The plain text password (before hashing)
      type,
      createdBy: parentUser|| null,
      loginUrl: loginurl
    });

    return Response.json({ staff: updatedStaff }, { status: 201 });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    await dbConnect();
    const { staffId, name, role, email, password, work_schedule } = await req.json();
    const schedule = work_schedule === undefined ? null : parseWorkSchedule(work_schedule);
    if (schedule?.error) return new Response(JSON.stringify({ message: schedule.error }), { status: 422 });

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
    // Find the staff member to update
    const staff = await User.findById(staffId);
    if (!staff) {
      return new Response(JSON.stringify({ message: "Staff not found" }), { status: 404 });
    }

    const emailNorm = email != null && String(email).trim() !== "" ? normalizeUserEmail(email) : null;

    // Check if email is being updated and if it already exists for another user
    if (emailNorm && emailNorm !== normalizeUserEmail(staff.email)) {
      const existingUser = await User.findOne({
        email: emailNorm,
        _id: { $ne: staffId },
      });

      if (existingUser) {
        return new Response(
          JSON.stringify({ message: "Email already registered with another user" }),
          { status: 400 }
        );
      }
    }

    // Update fields
    staff.name = name || staff.name;
    staff.role = role || staff.role;
    if (emailNorm) staff.email = emailNorm;
    if (schedule) staff.work_schedule = schedule.value ?? undefined; // null: back to the dealership's hours

    const plainPassword =
      password && String(password).trim() ? String(password).trim() : null;
    if (plainPassword) {
      staff.password = await bcrypt.hash(plainPassword, 10);
    }

    await staff.save();

    if (plainPassword) {
      let loginUrl = `${process.env.NEXT_PUBLIC_BASE_URL}`;
      if (staff.type === "vendor") {
        loginUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/agency`;
      } else {
        loginUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/${staff.type}`;
      }
      try {
        await resetPasswordAccountEmail({
          email: staff.email,
          name: staff.name,
          password: plainPassword,
          type: staff.type,
          createdBy: null,
          loginUrl,
          isPasswordReset: true,
        });
        console.log("Staff password update email sent successfully");
      } catch (emailErr) {
        console.error("Staff password update email failed:", emailErr);
      }
    }

    const updatedStaff = await User.findById(staffId).populate("role", "name");

    return new Response(
      JSON.stringify({ 
        message: "Staff updated successfully", 
        staff: updatedStaff 
      }), 
      { status: 200 }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ message: error.message }), 
      { status: 500 }
    );
  }
}


export async function DELETE(req) {
  try {
    await dbConnect();
    const { staffId } = await req.json();
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

    const user = await User.findByIdAndDelete(staffId);
    if (!user) {
      return new Response(JSON.stringify({ message: "User not found" }), { status: 404 });
    }

    return new Response(JSON.stringify({ message: "Staff deleted successfully" }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}



