// app/api/bookademo/route.js
import { NextResponse } from 'next/server';
import { getClientIp } from 'request-ip';
import { DemoRequest } from '@models/DemoRequest';
import dbConnect from "@lib/mongodb";
import { sendDemoRequestEmail } from "@lib/emailservice";
import { validateDemoPayload } from "@lib/formValidation";

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 10;
    const name = searchParams.get('name');
    const email = searchParams.get('email');
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let query = {};
    
    if (name) {
      query.name = { $regex: name, $options: 'i' };
    }
    
    if (email) query.email = { $regex: email, $options: 'i' };
    if (status) query.status = status;
    if (type) query.dealershipAgencyName = type;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const totalItems = await DemoRequest.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limit);
    
    const demoRequests = await DemoRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return NextResponse.json({
      success: true,
      data: demoRequests,
      currentPage: page,
      totalPages,
      totalItems,
      itemsPerPage: limit
    });
    
  } catch (error) {
    console.error('Error fetching demo requests:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    await dbConnect();

    const ipAddress = getClientIp(request) || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const body = await request.json();
    const validation = validateDemoPayload(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

    // Check for recent duplicate submissions
    const recentSubmission = await DemoRequest.findOne({
      email: data.email,
      createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      comment: { $regex: data.comment.substring(0, 30), $options: 'i' }
    });

    if (recentSubmission) {
      return NextResponse.json(
        { error: 'You recently submitted a similar demo request. Please wait before submitting again.' },
        { status: 429 }
      );
    }

    // Create and save new demo request
    const demoRequest = new DemoRequest({
      ...data,
      ipAddress,
      userAgent,
      status: 'pending',
      source: 'website'
    });

    await demoRequest.save();

    // Email failure should not block a successful submission
    try {
      await sendDemoRequestEmail(demoRequest);
    } catch (emailError) {
      console.error("Demo request email notification failed:", emailError);
    }

    return NextResponse.json(
      { success: true, data: demoRequest },
      { status: 201 }
    );

  } catch (error) {
    console.error('Demo request submission error:', error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return NextResponse.json(
        { error: errors.join(', ') },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Missing demo request ID' },
        { status: 400 }
      );
    }

    const deletedRequest = await DemoRequest.findByIdAndDelete(id);

    if (!deletedRequest) {
      return NextResponse.json(
        { error: 'Demo request not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Demo request deleted successfully' },
      { status: 200 }
    );

  } catch (error) {
    console.error('Error deleting demo request:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';