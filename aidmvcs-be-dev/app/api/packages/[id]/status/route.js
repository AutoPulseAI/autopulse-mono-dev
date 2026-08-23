// app/api/packages/[id]/status/route.js
import { NextResponse } from "next/server";
import Package from "@models/Package";
import { getServerSession } from "next-auth";

import dbConnect from "@lib/mongodb";

export async function PUT(request, { params }) {
  await dbConnect();
  

  try {
    const { id } = params;
    const { is_active } = await request.json();
    
    const updatedPackage = await Package.findByIdAndUpdate(
      id,
      { is_active },
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