// app/api/subscriptions/route.js
import { NextResponse } from "next/server";
import Subscription from "@models/Subscription";
import User from "@models/User";
import Package from "@models/Package";
import { getServerSession } from "next-auth";
//import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@lib/mongodb"; 
import stripe from "@lib/stripe";

export async function POST(request) {
  await dbConnect();
  //const session = await getServerSession(authOptions);

  /*if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }*/

  try {
    const body = await request.json();
    const { package_id, is_manual } = body;
    const user = await User.findById(session.user._id);

    // Get package
    const pkg = await Package.findById(package_id);
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    // Check if user type matches package type
    if (pkg.for_user_type !== user.type) {
      return NextResponse.json(
        { error: "This package is not for your user type" },
        { status: 400 }
      );
    }

    // Create Stripe checkout session
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: pkg.stripe_price_id,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?canceled=true`,
      customer: user.stripe_customer_id,
      metadata: {
        user_id: user._id.toString(),
        package_id: pkg._id.toString(),
      },
    });

    return NextResponse.json({ url: stripeSession.url });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}