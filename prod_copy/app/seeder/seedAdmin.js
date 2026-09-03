import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//  Load `.env.local`
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import dbConnect from "../lib/mongodb.js";
import User from "../models/User.js";
import Role from "../models/Role.js";
import Permission from "../models/Permission.js"; //  Import Permission Model

async function seedAdmin() {
  await dbConnect();

  //  Fetch all admin permissions
  const adminPermissions = await Permission.find({ entity: "admin" });

  let adminRole = await Role.findOne({ name: "Admin", entity: "admin" });

  if (!adminRole) {
    console.log("Admin role not found. Creating one...");

    //  Create the Admin Role and Assign All Permissions
    adminRole = new Role({
      name: "Admin",
      entity: "admin",
      permissions: adminPermissions.map((perm) => perm._id),
      entity_id: null, // Super Admin Role
    });

    await adminRole.save();
    console.log("Admin Role created and assigned all admin permissions.");
  } else {
    console.log("Admin Role already exists.");
  }

  //  Check if Admin User Exists
  const existingAdmin = await User.findOne({ email: "admin@gmail.com" });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash("!Q@W3e4r", 10);
    
    const admin = new User({
      name: "Super Admin",
      email: "admin@example.com",
      password: hashedPassword,
      type: "admin",
      role: adminRole._id,
      parent_id: null,
    });

    await admin.save();
    console.log("Admin user created successfully.");
  } else {
    existingAdmin.role = adminRole._id;
    await existingAdmin.save();

    console.log("Admin user already exists.");
  }

  process.exit();
}

//  Run Seeder
seedAdmin();
