// app/api/subscriptions/upgrade/route.js
import { NextResponse } from "next/server";
import stripe from "@lib/stripe";
import User from "@models/User";
import Package from "@models/Package";
import Subscription from "@models/Subscription";
import dbConnect from "@lib/mongodb";

export async function POST(request) {
  await dbConnect();
  const body = await request.json();

  try {
    const { user_id, package_id, current_subscription_id } = body;
    
    // Validate inputs
    if (!user_id || !package_id || !current_subscription_id) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Get records with package details populated
    const [user, newPackage, currentSubscription] = await Promise.all([
      User.findById(user_id),
      Package.findById(package_id),
      Subscription.findById(current_subscription_id).populate('package_id')
    ]);

    if (!user || !newPackage || !currentSubscription) {
      return NextResponse.json(
        { error: "User, package, or subscription not found" },
        { status: 404 }
      );
    }

    // Check if this is actually an upgrade (new package must be higher value)
    if (newPackage.price <= currentSubscription.package_id.price) {
      return NextResponse.json(
        { error: "You can only upgrade to a higher-value package" },
        { status: 400 }
      );
    }

    // For dealer packages, we don't need dealer count calculations
    if (newPackage.for_user_type === "dealer") {
      // Handle Stripe subscriptions
      if (currentSubscription.stripe_subscription_id) {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price: newPackage.stripe_price_id,
            quantity: 1
          }],
          mode: 'subscription',
          success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dealer/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dealer/subscribe`,
          customer_email: user.email,
          metadata: {
            user_id: user._id.toString(),
            package_id: newPackage._id.toString(),
            is_upgrade: "true",
            current_subscription_id: currentSubscription._id.toString()
          },
          subscription_data: {
            metadata: {
              replacing_subscription: currentSubscription.stripe_subscription_id
            }
          }
        });

        return NextResponse.json({ url: session.url });
      }

      // Handle manual upgrades for dealers
      currentSubscription.package_id = newPackage._id;
      await currentSubscription.save();

      // Update user's subscription reference
      user.current_subscription = currentSubscription._id;
      await user.save();

      return NextResponse.json({
        success: true,
        subscription: currentSubscription
      });
    }

    // Original vendor package handling remains the same
    if (newPackage.for_user_type === "vendor") {
      let finalDealerCount = Math.max(
        body.dealer_count || newPackage.min_dealers || 1,
        newPackage.min_dealers || 1
      );
      
      if (newPackage.max_dealers) {
        finalDealerCount = Math.min(finalDealerCount, newPackage.max_dealers);
      }

      if (currentSubscription.stripe_subscription_id) {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price: newPackage.stripe_base_price_id,
              quantity: 1
            },
            {
              price: newPackage.stripe_dealer_price_id,
              quantity: finalDealerCount
            }
          ],
          mode: 'subscription',
          success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/agency/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/agency/subscribe`,
          customer_email: user.email,
          metadata: {
            user_id: user._id.toString(),
            package_id: newPackage._id.toString(),
            is_upgrade: "true",
            current_subscription_id: currentSubscription._id.toString(),
            dealer_count: finalDealerCount.toString()
          },
          subscription_data: {
            metadata: {
              replacing_subscription: currentSubscription.stripe_subscription_id,
              dealer_count: finalDealerCount.toString()
            }
          }
        });

        return NextResponse.json({ url: session.url });
      }

      // Handle manual vendor upgrades
      currentSubscription.package_id = newPackage._id;
      currentSubscription.dealer_count = finalDealerCount;
      currentSubscription.max_dealers = newPackage.max_dealers;
      await currentSubscription.save();

      // Update vendor user
      user.current_subscription = currentSubscription._id;
      user.package_dealers_allowed = newPackage.max_dealers;
      user.dealer_count = finalDealerCount;
      await user.save();

      return NextResponse.json({
        success: true,
        subscription: currentSubscription
      });
    }

    return NextResponse.json(
      { error: "Invalid package type" },
      { status: 400 }
    );

  } catch (error) {
    console.error("Upgrade error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process upgrade" },
      { status: 500 }
    );
  }
}