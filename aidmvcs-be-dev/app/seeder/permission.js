import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";  
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import dbConnect from "../lib/mongodb.js";
import Permission from "../models/Permission.js"; 

const permissions = [
 
  { permission_name: "Manage Employee", entity: "admin", group: "Staff Management" },
  { permission_name: "Manage Employee's  Role", entity: "admin", group: "Role Management" },
  { permission_name: "Manage Dealer", entity: "admin", group: "Dealer Management" },
  { permission_name: "Manage Agency", entity: "admin", group: "Vendor Management" },
  { permission_name: "Email Log", entity: "admin", group: "Email Log" },
  { permission_name: "Manage Subscription", entity: "admin", group: "Manage Package " },
  { permission_name: "Manage Contact Us", entity: "admin", group: "Manage Contact " },
  { permission_name: "Manage Pages", entity: "admin", group: "Content" },
  
  
  { permission_name: "Manage Support Ticket", entity: "admin", group: "Support Management" },

  { permission_name: "Manage Employee", entity: "vendor", group: "Staff Management" },
  { permission_name: "Manage Employee's  Role", entity: "vendor", group: "Role Management" },
  { permission_name: "Manage Dealer", entity: "vendor", group: "Dealer Management" },
  
  { permission_name: "manage_dealer_booking", entity: "vendor", group: "Booking Management" },
 
  { permission_name: "Manage Subscription", entity: "vendor", group: "Subscription Management" },
  { permission_name: "Manage Support Ticket", entity: "vendor", group: "Support Management" },
 
  { permission_name: "Manage Employee", entity: "dealer", group: "Staff Management" },
  { permission_name: "Manage Employee's  Role", entity: "dealer", group: "Role Management" },
  { permission_name: "Manage Email Accounts", entity: "dealer", group: "Email Account Management" },
  { permission_name: "Manage Account Information", entity: "dealer", group: "Account Info" },
  { permission_name: "Manage Leads", entity: "dealer", group: "Leads Management" },
  { permission_name: "View Assigned Leads", entity: "dealer", group: "Leads Management" },
  { permission_name: "Assign Leads", entity: "dealer", group: "Leads Management" },
  { permission_name: "Manage Appoinment", entity: "dealer", group: "Booking Management" },
  { permission_name: "Manage Follow-up setting", entity: "dealer", group: "Setting Management" },
 
  { permission_name: "Manage Subscription", entity: "dealer", group: "Subscription Management" },
  { permission_name: "Manage Support Ticket", entity: "dealer", group: "Support Management" },
 
 
  { permission_name: "Manage Customer Conversation", entity: "dealer", group: "Conversion Management" },
];

async function seedPermissions() {
  await dbConnect();

  try {
    for (const item of permissions) {
      const existing = await Permission.findOne({ permission_name: item.permission_name,entity:item.entity });

      if (!existing) {
        await Permission.create(item); 
        console.log(`Created permission: ${item.permission_name}`);
      } else {
        console.log(`⚠️ Permission already exists: ${item.permission_name}`);
      }
    }

    console.log(" Permissions seeding completed!");
  } catch (error) {
    console.error(" Error seeding permissions:", error);
  } finally {
    process.exit();
  }
}

seedPermissions();
