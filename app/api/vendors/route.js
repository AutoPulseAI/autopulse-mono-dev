import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import User from "@models/User";
import Permission from "@models/Permission";
import Subscription from "@models/Subscription";
import Role from "@models/Role";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { sendStaffAccountEmail } from "@lib/emailservice";
import { normalizeUserEmail } from "@utils/userEmail";

export async function GET(req) {
  try {
    await dbConnect();
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page")) || 1;
    const name = url.searchParams.get("name");
    const email = url.searchParams.get("email");
    const subscribed = url.searchParams.get("subscribed");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const format = url.searchParams.get("format"); // 'csv' for export
    const limit = format === 'csv' ? 0 : 10; // No limit for CSV export

    // Build the query object
    const query = { type: "vendor", parent_id: { $eq: null } };

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

    // Date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (format === 'csv') {
      // Handle CSV export
      const vendors = await User.find(query)
        .populate("current_subscription.package_id", "name")
        .select("name email phone website current_subscription package_expiry dealer_count")
        .lean();

      // Convert to CSV
      const csvData = vendors.map(vendor => ({
        Name: vendor.name,
        Email: vendor.email,
        Phone: vendor.phone || 'N/A',
        Website: vendor.website || 'N/A',
        'Package Name': vendor.current_subscription?.package_id?.name || 'No package',
        'Subscription Type': vendor.current_subscription?.is_manual ? 'Manual' : 'Auto',
        'Expiry Date': vendor.package_expiry ? new Date(vendor.package_expiry).toLocaleDateString() : 'N/A',
        'Dealer Count': vendor.dealer_count || 0,
        'Created At': vendor.createdAt ? new Date(vendor.createdAt).toLocaleDateString() : 'N/A'
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
          'Content-Disposition': 'attachment; filename=vendors_export.csv'
        },
        status: 200
      });
    } else {
      // Normal paginated response
      const totalVendors = await User.countDocuments(query);
      const vendors = await User.find(query)
        .populate("role", "name")
        .populate({
          path: "current_subscription",
          populate: {
            path: "package_id",
            select: "name price duration pricing_model base_fee price_per_dealer min_dealers billing_interval"
          }
        })
        .select("name email phone website role parent_id current_subscription package_expiry package_dealers_allowed package_dealers_used dealer_count createdAt")
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      // Transform the data (keep your existing transformation logic)
      const vendorsWithCalculatedData = vendors.map(vendor => {
      let calculatedPrice = 0;
      let dealerCount = vendor.dealer_count || 0;
      
      if (vendor.current_subscription?.package_id) {
        const pkg = vendor.current_subscription.package_id;
        
        if (pkg.pricing_model === "per_dealer") {
          // Calculate price for per-dealer packages
          const effectiveDealerCount = Math.max(
            dealerCount,
            pkg.min_dealers || 1
          );
          calculatedPrice = pkg.base_fee + (pkg.price_per_dealer * effectiveDealerCount);
        } else {
          // Flat rate pricing
          calculatedPrice = pkg.price || 0;
        }

        // Update the subscription price with calculated value
        vendor.current_subscription.price = calculatedPrice;
      }

      return {
        ...vendor,
        subscription_type: vendor.current_subscription?.is_manual ? "Manual" : "Auto",
        dealer_count: dealerCount,
        calculated_price: calculatedPrice
      };
    });

      return new Response(JSON.stringify({ 
        vendors: vendorsWithCalculatedData, 
        totalPages: Math.ceil(totalVendors / limit) 
      }), { status: 200 });
    }
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

export async function POST(req) {
    try {
      await dbConnect();
      const { name, email, phone, website,  password } = await req.json();
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

      if (!name || !email || !password) {
        return new Response(JSON.stringify({ message: "All fields are required." }), { status: 400 });
      }

      const emailNorm = normalizeUserEmail(email);
      const existingUser = await User.findOne({ email: emailNorm });
      if (existingUser) {
        return new Response(JSON.stringify({ message: "Email already exists." }), { status: 400 });
      }
      if (phone) {
        const phoneExists = await User.findOne({ phone });
        if (phoneExists) {
          return new Response(JSON.stringify({ message: "Phone number already in use by another vendor." }), { status: 400 });
        }
      }
  
      // Check for unique website (if provided)
      if (website) {
        const websiteExists = await User.findOne({ website });
        if (websiteExists) {
          return new Response(JSON.stringify({ message: "Website URL already in use by another vendor." }), { status: 400 });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Create Vendor User
      const newVendor = new User({ name, email: emailNorm, password: hashedPassword, type: "vendor", parent_id: null,phone: phone || null,
        website: website || null });
      await newVendor.save();

      // Create Default "Admin" Role for Vendor
      const vendorRole = new Role({
        name: "Admin",
        entity: "vendor",
        entity_id: newVendor._id, // Assign role to this vendor
        permissions: [],
      });

      await vendorRole.save();
      if (!newVendor.role_id) {
          await updateUserRole(newVendor._id, vendorRole._id);
      }

      // Fetch Existing Vendor Permissions from DB
      const existingPermissions = await Permission.find({ entity: "vendor" });

      if (existingPermissions.length > 0) {
        vendorRole.permissions = existingPermissions.map((perm) => perm._id);
        await vendorRole.save();
      }
      const loginurl=`${process.env.NEXT_PUBLIC_BASE_URL}/agency`;
     
        
          await sendStaffAccountEmail({
            email: emailNorm,
            name,
            password, // The plain text password (before hashing)
            type:'vendor',
            createdBy:  null,
            loginUrl: loginurl
          });
      

      return new Response(JSON.stringify({ message: "Vendor created successfully", vendor: newVendor }), { status: 201 });

    } catch (error) {
      return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}

export async function PUT(req) {
  try {
    await dbConnect();
    const { name ,vendorId,email, role, parent_id,phone, website } = await req.json();
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
    const vendor = await User.findById(vendorId);
    if (!vendor) {
      return new Response(JSON.stringify({ message: "Vendor not found." }), { status: 404 });
    }
    const emailNorm = email != null && String(email).trim() !== "" ? normalizeUserEmail(email) : null;
    if (emailNorm && emailNorm !== normalizeUserEmail(vendor.email)) {
      const emailExists = await User.findOne({ email: emailNorm, _id: { $ne: vendorId } });
      if (emailExists) {
        return new Response(JSON.stringify({ message: "Email already in use by another vendor." }), { status: 400 });
      }
    }

    // Check for unique phone (if changed and not empty)
    if (phone && phone !== vendor.phone) {
      const phoneExists = await User.findOne({ phone, _id: { $ne: vendorId } });
      if (phoneExists) {
        return new Response(JSON.stringify({ message: "Phone number already in use by another vendor." }), { status: 400 });
      }
    }
    if (website && website !== vendor.website) {
      const websiteExists = await User.findOne({ website, _id: { $ne: vendorId } });
      if (websiteExists) {
        return new Response(JSON.stringify({ message: "Website URL already in use by another vendor." }), { status: 400 });
      }
    }
    vendor.name = name || vendor.name;
    if (emailNorm) vendor.email = emailNorm;
    vendor.role = role || vendor.role;
    vendor.phone = phone || vendor.phone;
    vendor.website = website || vendor.website;
    vendor.parent_id = parent_id || vendor.parent_id;
    await vendor.save();

    return new Response(JSON.stringify({ message: "Vendor updated successfully" }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    await dbConnect();
    const { vendorId } = await req.json();
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
    const vendor = await User.findByIdAndDelete(vendorId);
    if (!vendor) {
      return new Response(JSON.stringify({ message: "Vendor not found." }), { status: 404 });
    }

    // Detach all users (e.g., dealers) linked to this vendor by clearing vendor_id
    await User.updateMany({ vendor_id: vendorId }, { $set: { vendor_id: null } });

    return new Response(JSON.stringify({ message: "Vendor deleted successfully" }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    await dbConnect();
    const { vendorId, password } = await req.json();

    if (!vendorId || !password) {
      return new Response(JSON.stringify({ message: "Vendor ID and password are required." }), { status: 400 });
    }

    const vendor = await User.findById(vendorId);
    if (!vendor) {
      return new Response(JSON.stringify({ message: "Vendor not found." }), { status: 404 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    vendor.password = hashedPassword;
    await vendor.save();

    // Send email notification
    await sendStaffAccountEmail({
      email: vendor.email,
      name: vendor.name,
      password, // The plain text password (before hashing)
      type: 'vendor',
      createdBy: null,
      loginUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/agency`,
      isPasswordReset: true
    });

    return new Response(JSON.stringify({ message: "Password updated successfully" }), { status: 200 });

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
