// app/api/subscriptions/create/route.js
import { NextResponse } from "next/server";
import stripe from "@lib/stripe";
import User from "@models/User";
import Package from "@models/Package";
import dbConnect from "@lib/mongodb";

export async function POST(request) {
  await dbConnect();
  const body = await request.json();

  try {
    const user = await User.findById(body.user_id);
    const pkg = await Package.findById(body.package_id);

    if (!user || !pkg) {
      return NextResponse.json({ error: "User or package not found" }, { status: 404 });
    }

    // Initialize variables
    let finalPrice = pkg.price;
    let dealerCount = pkg.min_dealers || 1;
    let lineItems = [];
    let isPerDealerPricing = false;

    // Handle vendor packages with per-dealer pricing
    if (pkg.for_user_type === "vendor" && pkg.pricing_model === "per_dealer") {
      isPerDealerPricing = true;
      dealerCount = Math.max(
        body.dealer_count || pkg.min_dealers || 1,
        pkg.min_dealers || 1
      );
      
      if (pkg.max_dealers && dealerCount > pkg.max_dealers) {
        dealerCount = pkg.max_dealers;
      }
      
      finalPrice = pkg.base_fee + (pkg.price_per_dealer * dealerCount);

      // Create line items with proper price_data format
      lineItems = [
        // Base fee item
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${pkg.name} - Base Fee`,
              description: `Monthly base fee for ${pkg.name} package`
            },
            unit_amount: Math.round(pkg.base_fee * 100), // in cents
            recurring: {
              interval: pkg.billing_interval
            }
          },
          quantity: 1
        },
        // Per-dealer item
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${pkg.name} - Dealer Accounts`,
              description: `Additional dealer accounts (${dealerCount})`
            },
            unit_amount: Math.round(pkg.price_per_dealer * 100), // in cents
            recurring: {
              interval: pkg.billing_interval
            }
          },
          quantity: dealerCount
        }
      ];
    } else {
      // Standard pricing (flat rate)
      lineItems = [{
        price: pkg.stripe_price_id, // Use predefined price ID
        quantity: 1
      }];
    }

    // Determine redirect path
    let type = user.type === 'vendor' ? "agency" : user.type;

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/${type}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/${type}/subscribe`,
      customer_email: user.email,
      metadata: {
        user_id: user._id.toString(),
        package_id: pkg._id.toString(),
        ...(isPerDealerPricing && { 
          dealer_count: dealerCount,
          calculated_price: finalPrice,
          base_fee: pkg.base_fee,
          price_per_dealer: pkg.price_per_dealer
        })
      }
    });

    return NextResponse.json({ 
      url: session.url,
      session_id: session.id,
      ...(isPerDealerPricing && {
        dealer_count: dealerCount,
        calculated_price: finalPrice,
        price_breakdown: {
          base_fee: pkg.base_fee,
          price_per_dealer: pkg.price_per_dealer,
          total_dealer_cost: (pkg.price_per_dealer * dealerCount).toFixed(2)
        }
      })
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ 
      error: error.message || "Failed to create subscription" 
    }, { status: 500 });
  }
}