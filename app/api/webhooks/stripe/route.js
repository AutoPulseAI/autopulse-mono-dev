// app/api/webhooks/stripe/route.js
import stripe from "@lib/stripe";
import User from "@models/User";
import Subscription from "@models/Subscription";
import Package from "@models/Package";
import dbConnect from "@lib/mongodb";
import { NextResponse } from "next/server";

/** Stripe API 2025-03-31.basil+ moved subscription id under parent.subscription_details; top-level subscription is deprecated. */
function getInvoiceSubscriptionId(invoice) {
  if (invoice.subscription) return invoice.subscription;
  if (
    invoice.parent?.type === "subscription_details" &&
    invoice.parent.subscription_details?.subscription
  ) {
    return invoice.parent.subscription_details.subscription;
  }
  return null;
}

export async function POST(request) {
  await dbConnect();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }
  

  try {
    switch (event.type) {
      case "checkout.session.completed":
        const checkoutSession = event.data.object;
        await handleCheckoutSessionCompleted(checkoutSession);
        break;
      case "invoice.payment_succeeded":
        const invoice = event.data.object;
        await handleInvoicePaymentSucceeded(invoice);
        break;
      case "customer.subscription.deleted":
        const subscription = event.data.object;
        await handleSubscriptionDeleted(subscription);
        break;
      case "customer.subscription.updated":
        const updatedSubscription = event.data.object;
        await handleSubscriptionUpdated(updatedSubscription);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`Webhook handler error for ${event.type}:`, error);
    return NextResponse.json(
      { error: `Webhook handler error: ${error.message}` }, 
      { status: 500 }
    );
  }
}

async function handleCheckoutSessionCompleted(session) {
  try {
    if (session.payment_status !== 'paid') return;

    const userId = session.metadata?.user_id;
    const packageId = session.metadata?.package_id;

    if (!userId || !packageId) {
      console.log('Missing user_id or package_id in session metadata');
      return;
    }

    const [pkg, existingUser] = await Promise.all([
      Package.findById(packageId),
      User.findById(userId)
    ]);

    if (!pkg || !existingUser) {
      console.log('Package or user not found:', { packageId, userId });
      return;
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + pkg.duration);

    const subscription = new Subscription({
      user_id: userId,
      package_id: packageId,
      stripe_subscription_id: session.subscription,
      status: "active",
      start_date: new Date(),
      end_date: expiryDate
    });

    await subscription.save();

    const updateData = {
      current_subscription: subscription._id,
      package_expiry: expiryDate
    };

    if (existingUser.type === 'vendor') {
      updateData.package_dealers_allowed = pkg.max_dealers;
    }

    await User.findByIdAndUpdate(userId, updateData);
    console.log('Checkout session completed successfully');
  } catch (error) {
    console.error('Error handling checkout session completed:', error);
    throw error;
  }
}

async function handleInvoicePaymentSucceeded(invoice) {
  try {
    const subscriptionId = getInvoiceSubscriptionId(invoice);
    if (!subscriptionId) {
      console.log("Invoice has no subscription id (legacy or parent.subscription_details); skipping update.");
      return;
    }

    // Retrieve the subscription from Stripe to get current period end
    const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    const periodEnd = new Date(stripeSubscription.current_period_end * 1000);

    const subscription = await Subscription.findOne({
      stripe_subscription_id: subscriptionId,
    });

    if (!subscription) {
      console.log('No subscription found for invoice:', subscriptionId);
      return;
    }

    const user = await User.findById(subscription.user_id);
    const pkg = await Package.findById(subscription.package_id);

    if (!user || !pkg) {
      console.log('User or package not found:', { userId: subscription.user_id, packageId: subscription.package_id });
      return;
    }

    // Update subscription with new period dates
    subscription.start_date = new Date(stripeSubscription.current_period_start * 1000);
    subscription.end_date = periodEnd;
    subscription.status = "active";
    await subscription.save();

    // Update user's package expiry
    await User.findByIdAndUpdate(user._id, {
      package_expiry: periodEnd,
      ...(user.type === "vendor" && { package_dealers_allowed: pkg.max_dealers })
    });
    
    console.log('Invoice payment succeeded processed successfully');
  } catch (error) {
    console.error('Error handling invoice payment succeeded:', error);
    throw error;
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    console.log('Processing subscription update:', subscription.id);
    console.log('Subscription status:', subscription.status);
    console.log('Current period start:', subscription.current_period_start);
    console.log('Current period end:', subscription.current_period_end);
    console.log('Full subscription object keys:', Object.keys(subscription));
    console.log('Subscription items:', subscription.items);
    
    const dbSubscription = await Subscription.findOne({
      stripe_subscription_id: subscription.id,
    });

    if (!dbSubscription) {
      console.log('No database subscription found for Stripe subscription:', subscription.id);
      return;
    }

    console.log('Found database subscription:', {
      id: dbSubscription._id,
      status: dbSubscription.status,
      start_date: dbSubscription.start_date,
      end_date: dbSubscription.end_date
    });

    const user = await User.findById(dbSubscription.user_id);
    if (!user) {
      console.log('No user found for subscription:', dbSubscription.user_id);
      return;
    }

    console.log('Found user:', {
      id: user._id,
      email: user.email,
      current_package_expiry: user.package_expiry
    });

    // Update subscription status if changed
    if (subscription.status && subscription.status !== dbSubscription.status) {
      console.log(`Updating subscription status from ${dbSubscription.status} to ${subscription.status}`);
      dbSubscription.status = subscription.status;
    }

    // Update dates based on current period (with null checks)
    let datesUpdated = false;
    
    // Check if we have current period data, if not, try to get it from Stripe
    let currentPeriodStart = subscription.current_period_start;
    let currentPeriodEnd = subscription.current_period_end;
    
    if (!currentPeriodStart || !currentPeriodEnd) {
      console.log('Missing current period data, fetching from Stripe...');
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(subscription.id);
        currentPeriodStart = stripeSubscription.current_period_start;
        currentPeriodEnd = stripeSubscription.current_period_end;
        console.log('Fetched from Stripe - Start:', currentPeriodStart, 'End:', currentPeriodEnd);
      } catch (stripeError) {
        console.error('Error fetching subscription from Stripe:', stripeError);
      }
    }
    
    if (currentPeriodStart) {
      const newStartDate = new Date(currentPeriodStart * 1000);
      if (!dbSubscription.start_date || newStartDate.getTime() !== dbSubscription.start_date.getTime()) {
        dbSubscription.start_date = newStartDate;
        datesUpdated = true;
        console.log(`Updated start_date to: ${newStartDate.toISOString()}`);
      }
    }
    
    if (currentPeriodEnd) {
      const newEndDate = new Date(currentPeriodEnd * 1000);
      if (!dbSubscription.end_date || newEndDate.getTime() !== dbSubscription.end_date.getTime()) {
        dbSubscription.end_date = newEndDate;
        datesUpdated = true;
        console.log(`Updated end_date to: ${newEndDate.toISOString()}`);
      }
    }
    
    // Save subscription if there were changes
    if (datesUpdated || subscription.status !== dbSubscription.status) {
      await dbSubscription.save();
      console.log('Subscription updated successfully');
    }

    // Update user's package expiry if subscription is active
    if (subscription.status === 'active') {
      // If we have a new end date, use it; otherwise keep the existing one
      const newPackageExpiry = currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : dbSubscription.end_date;
      
      if (newPackageExpiry) {
        try {
          const updateResult = await User.findByIdAndUpdate(
            user._id, 
            { package_expiry: newPackageExpiry },
            { new: true, runValidators: true }
          );
          
          if (updateResult) {
            console.log(`User package_expiry updated to: ${newPackageExpiry.toISOString()}`);
            console.log('Updated user package_expiry:', updateResult.package_expiry);
          } else {
            console.error('Failed to update user package_expiry - no result returned');
          }
        } catch (updateError) {
          console.error('Error updating user package_expiry:', updateError);
          
          // Try alternative update method
          try {
            user.package_expiry = newPackageExpiry;
            await user.save();
            console.log(`User package_expiry updated via save() to: ${newPackageExpiry.toISOString()}`);
          } catch (saveError) {
            console.error('Error saving user with package_expiry:', saveError);
          }
        }
      } else {
        console.log('No valid end date available for package_expiry update');
      }
    } else {
      console.log(`Skipping package_expiry update - Status: ${subscription.status}`);
    }
    
  } catch (error) {
    console.error('Error handling subscription update:', error);
    throw error; // Re-throw to be caught by the main handler
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    const dbSubscription = await Subscription.findOne({
      stripe_subscription_id: subscription.id,
    });

    if (!dbSubscription) {
      console.log('No subscription found for deletion:', subscription.id);
      return;
    }

    dbSubscription.status = "canceled";
    await dbSubscription.save();

    const user = await User.findById(dbSubscription.user_id);
    if (user) {
      user.package_expiry = null;
      if (user.type === "vendor") {
        user.package_dealers_allowed = 0;
      }
      await user.save();
    }
    
    console.log('Subscription deleted successfully');
  } catch (error) {
    console.error('Error handling subscription deletion:', error);
    throw error;
  }
}

// Next.js 16 Route Segment Config  
export const runtime = 'nodejs';