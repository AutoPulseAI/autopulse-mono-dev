// app/api/subscriptions/request/route.js
import { NextResponse } from 'next/server';

import User from "@models/User";
import SubscriptionRequest from "@models/SubscriptionRequest";
import dbConnect from "@lib/mongodb";
import { sendSubscriptionRequestAdminEmail } from '@lib/emailservice';
import mongoose from 'mongoose';


export async function POST(request) {
  try {
    await dbConnect();

    const { 
      userId, 
      message, 
      phone, 
      email, 
      dealerCount 
    } = await request.json();

    // Validate required fields
    if (!userId || !dealerCount) {
      return NextResponse.json(
        { success: false, message: 'User ID and dealer count are required' },
        { status: 400 }
      );
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, message: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Check if user exists and get their details
    const user = await User.findById(userId).select('name email phone');
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    // Use provided contact details or fall back to user's details
    const contactEmail = email || user.email;
    const contactPhone = phone || user.phone;

    // Create new subscription request
    const newRequest = new SubscriptionRequest({
      user: userId,
      message,
      phone: contactPhone,
      email: contactEmail,
      dealerCount,
      status: 'pending',
      requestedAt: new Date()
    });

    await newRequest.save();

    // Send email notification to admin
   
    await sendSubscriptionRequestAdminEmail({
        requestId: newRequest._id,
        vendorName: user.name,
        email: user.email,
        phone: user.phone,
        dealerCount: dealerCount,
        message: message,
        requestedAt: new Date()
      });
      

  

    return NextResponse.json(
      { 
        success: true, 
        message: 'Subscription request submitted successfully',
        requestId: newRequest._id,
        data: {
          requestId: newRequest._id,
          dealerCount,
          contactEmail,
          contactPhone
        }
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Error processing subscription request:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'An error occurred while processing your request',
        error: error.message 
      },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch subscription requests (for admin dashboard)
export async function GET(request) {
  try {
    // Ensure database connection is established
    await dbConnect();
    
    // Double-check connection status
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database connection not ready');
    }

    // Verify admin permissions (you'll need to implement your auth check)
    const isAdmin = true; // Replace with actual admin check

    if (!isAdmin) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 10;

    const query = { status };
    const skip = (page - 1) * limit;

    const requests = await SubscriptionRequest.find(query)
      .populate('user', 'name email')
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await SubscriptionRequest.countDocuments(query);

    return NextResponse.json(
      { 
        success: true, 
        data: requests,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error('Error fetching subscription requests:', error);
    
    // Handle specific connection errors
    if (error.message.includes('Cannot call') || error.message.includes('before initial connection')) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Database connection not ready. Please try again.',
          error: 'CONNECTION_ERROR'
        },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to fetch subscription requests',
        error: error.message 
      },
      { status: 500 }
    );
  }
}