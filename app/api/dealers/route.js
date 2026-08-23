import dbConnect from "@lib/mongodb";
import User from "@models/User";
import Role from "@models/Role";
import Permission from "@models/Permission";
import FollowUpJob from "@models/FollowUpJob";
import Subscription from "@models/Subscription";
import Vehicle from "@models/Vehicle";
import EmailAccount from "@models/EmailAccount";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { sendStaffAccountEmail } from "@lib/emailservice";
import { normalizeUserEmail } from "@utils/userEmail";

// GET - Fetch Dealers
// Add this new route handler in route.js
export async function GET(req) {
  try {
    await dbConnect();
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page")) || 1;
    const name = url.searchParams.get("name");
    const email = url.searchParams.get("email");
     const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const subscribed = url.searchParams.get("subscribed");
    const dealerType = url.searchParams.get("dealer_type"); // 'independent' or 'vendor'
    const vendorId = url.searchParams.get("vendor_id");
    const format = url.searchParams.get("format"); // 'csv' for export
    const limit = format === 'csv' ? 0 : 10; // No limit for CSV export

    // Build the query object
    const query = { type: "dealer", parent_id: { $eq: null } };

    // Name filter
    if (name) {
      query.name = { $regex: name, $options: "i" };
    }

    // Email filter
    if (email) {
      query.email = { $regex: email, $options: "i" };
    }


    // Subscription status filter
    if (subscribed === '1') {
      query.current_subscription = { $ne: null };
    } else if (subscribed === '0') {
      query.current_subscription = { $eq: null };
    }

     if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Dealer type filter
    if (dealerType === 'independent') {
      query.vendor_id = { $eq: null };
    } else if (dealerType === 'vendor') {
      query.vendor_id = { $ne: null };
    }

    // Vendor filter
    if (vendorId) {
      query.vendor_id = vendorId;
    }

    if (format === 'csv') {
      // Handle CSV export
      const dealers = await User.find(query)
        .populate("vendor_id", "name")
        .populate({
          path: "current_subscription",
          populate: {
            path: "package_id",
            select: "name"
          }
        })
        .lean();

      // Convert to CSV
      const csvData = dealers.map(dealer => ({
        Name: dealer.name,
        Email: dealer.email,
        'Dealer Type': dealer.vendor_id ? 'Vendor Dealer' : 'Independent Dealer',
        Store: dealer.dealer_account_information?.store_name || 'N/A',
        City: dealer.dealer_account_information?.store_city || 'N/A',
        Package: dealer.current_subscription?.package_id?.name || 'No package',
        Vendor: dealer.vendor_id?.name || 'No Vendor',
        'Expiry Date': dealer.package_expiry ? new Date(dealer.package_expiry).toLocaleDateString() : 'N/A',
        'Subscription Status': dealer.current_subscription ? 'Subscribed' : 'Unsubscribed'
      }));

      const csvHeaders = Object.keys(csvData[0] || {}).join(',');
      const csvRows = csvData.map(row => 
        Object.values(row).map(field => 
          `"${String(field).replace(/"/g, '""')}"`
        ).join(',')
      ).join('\n');

      const csvContent = [csvHeaders, csvRows].join('\n');

      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=dealers_export.csv'
        },
        status: 200
      });
    } else {
      // Normal paginated response
      const totalDealers = await User.countDocuments(query);
      const dealers = await User.find(query)
        .populate("vendor_id", "name email")
        .populate({
          path: "current_subscription",
          populate: {
            path: "package_id",
            select: "name price duration pricing_model base_fee price_per_dealer min_dealers billing_interval"
          }
        })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec();

      return new Response(
        JSON.stringify({ dealers, totalPages: Math.ceil(totalDealers / limit) }),
        { status: 200 }
      );
    }
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

// POST - Create Dealer
export async function POST(req) {
  try {
    await dbConnect();
    const { name, email, password, vendor_id = null } = await req.json();
    const emailNorm = normalizeUserEmail(email);

    // Validate required fields
    if (!name || !email || !password) {
      return new Response(JSON.stringify({ message: "All fields are required." }), { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm)) {
      return new Response(JSON.stringify({ message: "Please enter a valid email address." }), { status: 400 });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: emailNorm });
    if (existingUser) {
      return new Response(
        JSON.stringify({ message: "This email is already registered. Please use a different email address." }),
        { status: 400 }
      );
    }

    const validVendorId = vendor_id && mongoose.Types.ObjectId.isValid(vendor_id) ? vendor_id : null;

    // Check dealer limit if vendor_id is provided
    if (validVendorId) {
      const vendor = await User.findById(validVendorId);
      if (!vendor) {
        return new Response(JSON.stringify({ message: "Vendor not found." }), { status: 404 });
      }

      // Get actual count of dealers for this vendor
      const dealerCount = await User.countDocuments({ 
        vendor_id: validVendorId,
        type: "dealer"
      });
      console.log(dealerCount);
      if (dealerCount >= vendor.package_dealers_used) {
        return new Response(
          JSON.stringify({ 
            message: `You have reached your dealer limit (${vendor.package_dealers_used}). Please upgrade your package to add more dealers.`
          }), 
          { status: 400 }
        );
      }
    }


    // Hash password and create dealer
    const hashedPassword = await bcrypt.hash(password, 10);
    const newDealer = new User({ 
      name, 
      email: emailNorm, 
      password: hashedPassword, 
      type: "dealer", 
      vendor_id: validVendorId 
    });
    await newDealer.save();

    // Update vendor's dealer count if applicable
    

    // Assign "Admin" Role
    const dealerRole = new Role({ 
      name: "Admin", 
      entity: "dealer", 
      entity_id: newDealer._id 
    });
    await dealerRole.save();

    if (!newDealer.parent_id) {
      const existingPermissions = await Permission.find({ entity: "dealer" });
      
      if (existingPermissions.length > 0) {
        dealerRole.permissions = existingPermissions.map((perm) => perm._id);
        await dealerRole.save();
      }
    }

    if (!newDealer.role_id) {
      await updateUserRole(newDealer._id, dealerRole._id);
    }

    // Send account creation email
    const loginurl = `${process.env.NEXT_PUBLIC_BASE_URL}/dealer`;
    //const parentUser = validVendorId ? await User.findById(validVendorId).select('name,email,phone,website').lean()  : null;
    const parentUser = validVendorId ? await User.findById(validVendorId).select('name email phone website') : null;
   
    await sendStaffAccountEmail({
      email: emailNorm,
      name,
      password, 
      type: 'dealer',
      createdBy: parentUser ||null,
      loginUrl: loginurl
    });

    return new Response(
      JSON.stringify({ 
        message: "Dealer created successfully", 
        dealer: newDealer 
      }), 
      { status: 201 }
    );

  } catch (error) {
    console.error("Error creating dealer:", error);
    return new Response(
      JSON.stringify({ 
        message: "An error occurred while creating the dealer. Please try again." 
      }), 
      { status: 500 }
    );
  }
}
// PUT - Update Dealer
export async function PUT(req) {
  try {
    await dbConnect();
    const { dealer_id, name, email, vendor_id } = await req.json();

    if (!dealer_id) {
      return new Response(JSON.stringify({ message: "Dealer ID is required." }), { status: 400 });
    }

    // Check if email is being changed and validate it
    const existingDealer = await User.findById(dealer_id);
    if (!existingDealer) {
      return new Response(JSON.stringify({ message: "Dealer not found." }), { status: 404 });
    }

    const emailNorm = email != null && String(email).trim() !== "" ? normalizeUserEmail(email) : null;
    if (emailNorm && emailNorm !== normalizeUserEmail(existingDealer.email)) {
      const emailExists = await User.findOne({ email: emailNorm, _id: { $ne: dealer_id } });
      if (emailExists) {
        return new Response(JSON.stringify({ message: "Email already in use by another user." }), { status: 400 });
      }
    }

    // Prepare update object
    const updateData = { 
      name: name || existingDealer.name,
      email: emailNorm || existingDealer.email,
    };

    if (vendor_id !== undefined) {
      if (!vendor_id) {
        updateData.vendor_id = null;
      } else if (!mongoose.Types.ObjectId.isValid(vendor_id)) {
        return new Response(JSON.stringify({ message: "Invalid vendor ID." }), { status: 400 });
      } else {
        updateData.vendor_id = vendor_id;
      }
    }

    const updatedDealer = await User.findByIdAndUpdate(
      dealer_id, 
      updateData, 
      { new: true }
    );

    // Update Admin role permissions if exists
    const adminRole = await Role.findOne({
      name: "Admin",
      entity: "dealer",
      entity_id: dealer_id
    });
    
    if (adminRole && !updatedDealer.parent_id) {
      const existingPermissions = await Permission.find({ entity: "dealer" });
      
      if (existingPermissions.length > 0) {
        adminRole.permissions = existingPermissions.map((perm) => perm._id);
        await adminRole.save();
      }
    }
    if (!existingDealer.role_id) {
      await updateUserRole(dealer_id, adminRole._id);
    }

    return new Response(
      JSON.stringify({ 
        message: "Dealer updated successfully", 
        dealer: updatedDealer 
      }), 
      { status: 200 }
    );

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

// DELETE - Remove Dealer
export async function DELETE(req) {
  try {
    await dbConnect();
    const { dealerId } = await req.json();

    if (!dealerId) {
      return new Response(JSON.stringify({ message: "Dealer ID is required." }), { status: 400 });
    }

    const deletedDealer = await User.findByIdAndDelete(dealerId);

    if (!deletedDealer) {
      return new Response(JSON.stringify({ message: "Dealer not found." }), { status: 404 });
    }

    // Cascade deletes for related documents
    // 1) Remove only pending follow-up jobs for this dealer
    await FollowUpJob.deleteMany({ dealer_id: String(dealerId), status: 'pending' });
    // 2) Remove subscriptions belonging to this dealer
    await Subscription.deleteMany({ user_id: dealerId });
    // 3) Remove vehicles belonging to this dealer
    await Vehicle.deleteMany({ dealerId: String(dealerId) });
    // 4) Remove roles scoped to this dealer entity
    await Role.deleteMany({ entity: 'dealer', entity_id: dealerId });
    // 5) Remove email accounts associated with this dealer
    await EmailAccount.deleteMany({ dealer_id: dealerId });

    return new Response(JSON.stringify({ message: "Dealer deleted successfully" }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
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
