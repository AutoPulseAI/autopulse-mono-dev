// app/api/packages/route.js
import { NextResponse } from "next/server";
import Package from "@models/Package";
import { getServerSession } from "next-auth";

import dbConnect from "@lib/mongodb";
import stripe from "@lib/stripe";

export async function GET(request) {
  await dbConnect();
  const { searchParams } = new URL(request.url);
  const forUserType = searchParams.get('for_user_type');
  const page = parseInt(searchParams.get('page')) || 1;
  const limit = 100;
  const skip = (page - 1) * limit;

  try {
    const query = {};
    if (forUserType) {
      query.for_user_type = forUserType;
    }

    const packages = await Package.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Package.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({ 
      packages, 
      totalPages,
      currentPage: page,
      forUserType
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request) {
  await dbConnect();
  
  try {
    const body = await request.json();
    const { 
      name, 
      description, 
      price, 
      hide,
      max_dealers, 
      features, 
      discount, 
      for_user_type, 
      is_active,
      pricing_model,
      base_fee,
      price_per_dealer,
      min_dealers,
      billing_interval
    } = body;

    // Create Stripe product
    const stripeProduct = await stripe.products.create({
      name: name,
      description: description,
    });

    let stripePrice;
    if (pricing_model === "per_dealer") {
      // For per-dealer pricing, we'll create a base price in Stripe
      // The actual charges will be calculated and applied via Stripe subscriptions or invoices
      stripePrice = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: base_fee * 100, // Base fee in cents
        currency: "usd",
        recurring: {
          interval: billing_interval,
        },
      });
    } else {
      // Flat rate pricing
      stripePrice = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: price * 100, // Price in cents
        currency: "usd",
        recurring: {
          interval: billing_interval,
        },
      });
    }

    const newPackage = new Package({
      name,
      description,
      price: pricing_model === "flat" ? price : undefined,
      duration :billing_interval === "month" ? 30 : 365,
      hide: !!hide,
      max_dealers,
      features,
      discount,
      for_user_type,
      stripe_price_id: stripePrice.id,
      is_active,
      pricing_model,
      base_fee,
      price_per_dealer,
      min_dealers,
      billing_interval
    });

    await newPackage.save();

    return NextResponse.json(newPackage, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}