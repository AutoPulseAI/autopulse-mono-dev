// app/api/subscriptions/modify/route.js
import { NextResponse } from "next/server";
import stripe from "@lib/stripe";
import User from "@models/User";
import Subscription from "@models/Subscription";
import dbConnect from "@lib/mongodb";

export async function POST(request) {
  await dbConnect();
  const body = await request.json();

  try {
    const { subscriptionId, newDealerCount } = body;
    
    if (!subscriptionId || !newDealerCount) {
      return NextResponse.json(
        { error: "Subscription ID and new dealer count required" },
        { status: 400 }
      );
    }

    // Get subscription with user and package
    const subscription = await Subscription.findById(subscriptionId)
      .populate('user_id')
      .populate('package_id');

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    // Validate dealer count
    const minDealers = subscription.package_id.min_dealers || 1;
    const maxDealers = subscription.package_id.max_dealers;
    const validatedCount = Math.max(
      minDealers,
      Math.min(newDealerCount, maxDealers || Infinity)
    );

    if (subscription.stripe_subscription_id) {
      // Stripe-managed subscription
      const stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id
      );

      // Find the dealer price item
      const dealerItem = stripeSubscription.items.data.find(item => 
        item.price.metadata?.item_type === 'dealer'
      );

      if (!dealerItem) {
        return NextResponse.json(
          { error: "Dealer pricing item not found in subscription" },
          { status: 400 }
        );
      }

      // Update subscription with new quantity
      const updatedSubscription = await stripe.subscriptions.update(
        subscription.stripe_subscription_id,
        {
          items: [{
            id: dealerItem.id,
            quantity: validatedCount,
          }],
          proration_behavior: 'always_invoice' // or 'create_prorations'
        }
      );

      // Update local subscription record
      subscription.dealer_count = validatedCount;
      await subscription.save();

      // Update user
      await User.findByIdAndUpdate(
        subscription.user_id._id,
        { dealer_count: validatedCount }
      );

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscription._id,
          dealer_count: validatedCount,
          next_payment: updatedSubscription.current_period_end
        }
      });
    } else {
      // Manual subscription - just update the records
      subscription.dealer_count = validatedCount;
      await subscription.save();

      await User.findByIdAndUpdate(
        subscription.user_id._id,
        { dealer_count: validatedCount }
      );

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscription._id,
          dealer_count: validatedCount
        }
      });
    }
  } catch (error) {
    console.error("Modification error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to modify subscription" },
      { status: 500 }
    );
  }
}