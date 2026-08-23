// app/api/packages/[id]/route.js
import { NextResponse } from "next/server";
import Package from "@models/Package";
import { getServerSession } from "next-auth";

import dbConnect from "@lib/mongodb";
import stripe from "@lib/stripe";

export async function PUT(request, { params }) {
  await dbConnect();
 

  try {
    const { id } = await params;
    const body = await request.json();
    // Only allow safe fields to be updated (no pricing changes via this route per request)
    const {
      name,
      description,
      features,
      is_active,
      hide,
      discount,
      max_dealers
    } = body;

    const update = {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(Array.isArray(features) ? { features } : {}),
      ...(is_active !== undefined ? { is_active } : {}),
      ...(hide !== undefined ? { hide: !!hide } : {}),
      ...(discount !== undefined ? { discount } : {}),
      ...(max_dealers !== undefined ? { max_dealers } : {}),
    };

    const updatedPackage = await Package.findByIdAndUpdate(
      id,
      update,
      { new: true }
    );

    if (!updatedPackage) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    return NextResponse.json(updatedPackage);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  await dbConnect();
  const session = await getServerSession(authOptions);

  if (!session || session.user.type !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = params;
    const deletedPackage = await Package.findByIdAndDelete(id);

    if (!deletedPackage) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    // Optionally delete from Stripe
    try {
      await stripe.products.del(deletedPackage.stripe_product_id);
    } catch (stripeError) {
      console.error("Error deleting Stripe product:", stripeError);
    }

    return NextResponse.json({ message: "Package deleted successfully" });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}