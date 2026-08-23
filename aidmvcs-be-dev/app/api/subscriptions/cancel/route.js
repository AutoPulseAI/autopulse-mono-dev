import { NextResponse } from "next/server";
import stripe from "@lib/stripe";
import User from "@models/User";
import Subscription from "@models/Subscription";
import dbConnect from "@lib/mongodb";

export async function POST(request) {
  await dbConnect();
  const { subscriptionId, immediate = false } = await request.json();

  try {
    const subscription = await Subscription.findById(subscriptionId)
      .populate('user_id')
      .populate('package_id');

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    // For Stripe subscriptions
    if (subscription.stripe_subscription_id) {
      if (immediate) {
        await stripe.subscriptions.del(subscription.stripe_subscription_id);
      } else {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true
        });
      }
    }

    // Update subscription status (using correct enum value)
    if (immediate) {
      subscription.status = 'canceled';
      subscription.end_date = new Date();
    } else {
      subscription.status = 'pending_cancellation'; // Corrected spelling
    }
    
    await subscription.save();

    // For immediate cancellation, update user immediately
    if (immediate) {
      const user = await User.findById(subscription.user_id._id);
      if (user) {
        user.current_subscription = null;
        user.package_expiry = null;
        
        if (user.type === 'vendor') {
          user.package_dealers_allowed = 0;
          user.dealer_count = 0;
        }
        
        await user.save();
      }
    }

    return NextResponse.json({ 
      success: true,
      message: immediate 
        ? "Subscription canceled immediately" 
        : "Subscription will cancel at the end of the billing period",
      cancellation_type: immediate ? "immediate" : "end_of_period",
      effective_date: immediate ? new Date() : subscription.end_date
    });

  } catch (error) {
    console.error("Cancellation error:", error);
    return NextResponse.json({ 
      error: error.message || "Failed to cancel subscription",
      details: error.errors // Include validation errors if available
    }, { status: 500 });
  }
}