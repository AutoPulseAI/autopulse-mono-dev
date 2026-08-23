// app/api/packages/[id]/route.js
import { NextResponse } from "next/server";
import Lead from "@models/Lead";
import { getServerSession } from "next-auth";
import dbConnect from "@lib/mongodb";
import { authOptions } from "@lib/auth";
import User from "@models/User";
import jwt from 'jsonwebtoken';

export async function GET(request, { params }) {
  try {
    await dbConnect();
    
    // Get the session
  

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    
    // Find the lead package
    const lead= await Lead.findOne({
      _id: id,
    
    }).lean();

    

    // Find the specific package by ID within the lead's packages array
   

    return NextResponse.json(
      { lead },
      { status: 200 }
    );

  } catch (error) {
    console.error("Error fetching lead:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request, { params }) {
  try {
    await dbConnect();
    
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const currentUser = await User.findById(decoded.userId);
        if (currentUser) {
         
        }else{
          return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
        }
       
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
   
   
    const { id } = await params;
    const body = await request.json();
    
    console.log('Updating lead:', id, 'with data:', body);
    
    // Extract the fields we want to update
    const updateData = {};
    
    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.vin !== undefined) updateData.vin = body.vin;
    if (body.vehicle_make !== undefined) updateData.vehicle_make = body.vehicle_make;
    if (body.vehicle_model !== undefined) updateData.vehicle_model = body.vehicle_model;
    if (body.vehicle_year !== undefined) updateData.vehicle_year = body.vehicle_year;
    if (body.lead_source !== undefined) updateData.lead_source = body.lead_source;
    if (body.comments !== undefined) updateData.comments = body.comments;
    if (body.assigned_to !== undefined) updateData.assigned_to = body.assigned_to;
    
    // Add updatedAt timestamp
    updateData.updatedAt = new Date();
    
    // Find and update the lead
    const updatedLead = await Lead.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!updatedLead) {
      return NextResponse.json(
        { error: "Lead not found" },
        { status: 404 }
      );
    }
    
    console.log('Lead updated successfully:', updatedLead);
    
    return NextResponse.json(
      { 
        success: true,
        message: "Lead updated successfully",
        lead: updatedLead 
      },
      { status: 200 }
    );
    
  } catch (error) {
    console.error("Error updating lead:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}