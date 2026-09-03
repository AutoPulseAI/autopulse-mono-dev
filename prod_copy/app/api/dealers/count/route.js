import dbConnect from "@lib/mongodb";
import User from "@models/User";
import Role from "@models/Role";
import Permission from "@models/Permission";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { sendStaffAccountEmail } from "@lib/emailservice";

// GET - Fetch Dealers
export async function GET(req) {
  try {
      await dbConnect();
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const vendorId = url.searchParams.get("vendor_id"); // Get vendor_id from query params
      const limit = 10;

      // Build the query object
      const query = { type: "dealer", parent_id: { $eq: null }  };
      if (vendorId) {
          query.vendor_id = vendorId; // Add vendor_id filter if provided
      }

      const totalDealers = await User.countDocuments(query);
     

      return new Response(
          JSON.stringify({  count: totalDealers }),
          { status: 200 }
      );
  } catch (error) {
      return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

// POST - Create Dealer

