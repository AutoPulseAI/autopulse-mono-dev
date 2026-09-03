// app/api/subscriptions/manual/route.js
import { NextResponse } from "next/server";
import Subscription from "@models/Subscription";
import User from "@models/User";
import Package from "@models/Package";
import dbConnect from "@lib/mongodb";
import { subscriptionActivatedmanual } from "@lib/emailservice";
import jwt from "jsonwebtoken";
export async function POST(request) {
  await dbConnect();
  const body = await request.json();
  const authHeader = request.headers.get("Authorization");
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
  try {
    const [user, pkg] = await Promise.all([
      User.findById(body.user_id),
      Package.findById(body.package_id),
    ]);

    if (!user || !pkg) {
      return NextResponse.json(
        { error: "User or package not found" },
        { status: 404 }
      );
    }

    if (pkg.for_user_type !== user.type) {
      return NextResponse.json(
        { error: "Package type doesn't match user type" },
        { status: 400 }
      );
    }

    // Calculate price and dealer count for vendor packages
    let finalPrice = pkg.price;
    let dealerCount = 0;
    
    if (pkg.for_user_type === "vendor" && pkg.pricing_model === "per_dealer") {
      dealerCount = Math.max(body.dealer_count || 1, pkg.min_dealers || 1);
      finalPrice = pkg.base_fee + (pkg.price_per_dealer * dealerCount);
    }

    // Calculate expiry date based on billing interval
    const expiryDate = new Date();
    if (pkg.billing_interval === "month") {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    } else {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    }

    // Create subscription
    const newSubscription = new Subscription({
      user_id: user._id,
      package_id: pkg._id,
      status: "active",
      start_date: new Date(),
      end_date: expiryDate,
      is_manual: true,
      price: finalPrice,
      ...(pkg.for_user_type === "vendor" && { 
        package_dealers_used: dealerCount,
        max_dealers: pkg.max_dealers
      })
    });

    await newSubscription.save();

    // Update user
    user.current_subscription = newSubscription._id;
    user.package_expiry = expiryDate;

    if (user.type === "vendor") {
      user.package_dealers_allowed = pkg.max_dealers;
      user.dealer_count = dealerCount;
      user.package_dealers_used= dealerCount
    }

    await user.save();
    const subscriptionData = {
      ...newSubscription.toObject(), // Convert Mongoose doc to plain object
      price: finalPrice, // Ensure calculated price is included
      ...(pkg.for_user_type === "vendor" && {
        package_dealers_used: dealerCount,
        max_dealers: pkg.max_dealers
      })
    };
   
    await subscriptionActivatedmanual({
                user,
                subscriptionData,
                pkg
            
    });

    return NextResponse.json(newSubscription, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ 
      error: error.message || "Server error" 
    }, { status: 500 });
  }
}