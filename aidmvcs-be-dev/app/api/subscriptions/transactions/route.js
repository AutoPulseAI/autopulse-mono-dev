// app/api/subscriptions/transactions/route.js
import { NextResponse } from "next/server";
import stripe from "@lib/stripe";
import User from "@models/User";
import { getServerSession } from "next-auth";
//import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@lib/mongodb";
import { requireActingFor } from "@lib/apiGuard";

export async function GET(request) {
  await dbConnect();
  //const session = await getServerSession(authOptions);
  const { searchParams } = new URL(request.url);
  const user_id = searchParams.get("user_id");
  // Security fix (Nov 2026): only the account itself (or its dealership/agency, or a super admin); this had no sign-in check.
  const guard = await requireActingFor(request, user_id);
  if (guard.response) return guard.response;
  

  try {
    // Get user's Stripe customer ID if exists
    const user = await User.findById(user_id);
    if (!user.stripe_customer_id) {
      return NextResponse.json({ transactions: [] });
    }

    // Fetch payments from Stripe
    const payments = await stripe.paymentIntents.list({
      customer: user.stripe_customer_id,
      limit: 100
    });

    // Format transactions
    const transactions = payments.data.map(payment => ({
      id: payment.id,
      amount: payment.amount / 100,
      currency: payment.currency,
      status: payment.status,
      description: payment.description || 'Subscription payment',
      date: new Date(payment.created * 1000)
    }));

    return NextResponse.json({ transactions });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}