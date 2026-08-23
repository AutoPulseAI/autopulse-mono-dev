// app/api/subscriptions/verify/route.js
import { NextResponse } from "next/server";
import stripe from "@lib/stripe";
import User from "@models/User";
import Package from "@models/Package";
import Subscription from "@models/Subscription";
import dbConnect from "@lib/mongodb";

import { dealersubscriptionActivated } from "@lib/emailservice";
export async function POST(request) {
  await dbConnect();
  const body = await request.json();
  const sessionId = body.session_id;

  if (!sessionId) {
    return NextResponse.json({ error: "Session ID required" }, { status: 400 });
  }

  try {
    // Retrieve the checkout session with expanded data
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'subscription.items', 'subscription.latest_invoice']
    });

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }

    const userId = session.metadata.user_id;
    const packageId = session.metadata.package_id;
    const isUpgrade = session.metadata.is_upgrade === 'true';
    const currentSubscriptionId = session.metadata.current_subscription_id;
    const dealerCount = parseInt(session.metadata.dealer_count) || 0;

    // Get package and user
    const [pkg, user] = await Promise.all([
      Package.findById(packageId),
      User.findById(userId)
    ]);

    if (!pkg || !user) {
      return NextResponse.json({ error: "Package or user not found" }, { status: 404 });
    }

    // Calculate expiry date based on billing interval
    const expiryDate = new Date();
    if (pkg.billing_interval === 'month') {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    } else {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    }

    // Handle subscription creation/update
    let subscription;
    let updateData = {
      package_expiry: expiryDate,
      ...(user.type === 'vendor' && {
        package_dealers_allowed: pkg.max_dealers,
        package_dealers_used: dealerCount
      })
    };

    if (isUpgrade && currentSubscriptionId) {
      // Upgrade existing subscription
      subscription = await Subscription.findByIdAndUpdate(
        currentSubscriptionId,
        {
          package_id: packageId,
          stripe_subscription_id: session.subscription.id,
          status: "active",
          start_date: new Date(),
          end_date: expiryDate,
          is_auto_renew: true,
          ...(user.type === 'vendor' && {
            dealer_count: dealerCount,
            max_dealers: pkg.max_dealers
          })
        },
        { new: true }
      );
      updateData.current_subscription = subscription._id;
    } else {
      // New subscription
      subscription = new Subscription({
        user_id: userId,
        package_id: packageId,
        stripe_subscription_id: session.subscription.id,
        status: "active",
        start_date: new Date(),
        end_date: expiryDate,
        is_auto_renew: true,
        ...(user.type === 'vendor' && {
          dealer_count: dealerCount,
          max_dealers: pkg.max_dealers
        })
      });
      await subscription.save();
      updateData.current_subscription = subscription._id;
    }

    const subscriptionData = {
      start_date: new Date(),
      end_date: expiryDate,
      billing_interval: pkg.billing_interval,
      amount_paid: (session.amount_total / 100).toFixed(2),
      status: "active"
    };
   
    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).populate({
      path: 'current_subscription',
      populate: { path: 'package_id' }
    });
    await dealersubscriptionActivated({
      user: updatedUser,
      subscriptionData,
      pkg
    });


    return NextResponse.json({ 
      success: true,
      subscription: {
        _id: subscription._id,
        status: subscription.status,
        package: subscription.package_id,
        dealer_count: subscription.dealer_count,
        max_dealers: subscription.max_dealers,
        start_date: subscription.start_date,
        end_date: subscription.end_date
      },
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        package_dealers_allowed: updatedUser.package_dealers_allowed,
        dealer_count: updatedUser.dealer_count
      }
    });
  } catch (error) {
    console.error("Verification error:", error);
    return NextResponse.json({ 
      error: error.message || "Verification failed" 
    }, { status: 500 });
  }
}