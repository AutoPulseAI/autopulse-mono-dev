// app/api/contact/route.js
import { NextResponse } from 'next/server';
import { getClientIp } from 'request-ip';
import { Contacts } from '@models/Contacts';
import dbConnect from "@lib/mongodb";
import { sendContactEmail } from "@lib/emailservice";
import { validateContactPayload } from "@lib/formValidation";

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 10;
    const name = searchParams.get('name');
    const email = searchParams.get('email');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let query = {};
    
    if (name) {
      const nameRegex = new RegExp(name.replace(/\s+/g, '.*'), 'i');
      query.$or = [
        { firstName: { $regex: nameRegex } },
        { lastName: { $regex: nameRegex } },
        { 
          $expr: { 
            $regexMatch: { 
              input: { $concat: ["$firstName", " ", "$lastName"] }, 
              regex: nameRegex 
            } 
          } 
        }
      ];
    }
    
    if (email) query.email = { $regex: email, $options: 'i' };
    if (status) query.status = status;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const totalItems = await Contacts.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limit);
    
    const contacts = await Contacts.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return NextResponse.json({
      success: true,
      data: contacts,
      currentPage: page,
      totalPages,
      totalItems,
      itemsPerPage: limit
    });
    
  } catch (error) {
    console.error('Error fetching contacts:', error);
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
    const body = await request.json();
    const validation = validateContactPayload(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

    // Check for recent duplicate submissions
    const recentSubmission = await Contacts.findOne({
      email: data.email,
      createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      message: { $regex: data.message.substring(0, 30), $options: 'i' }
    });

    if (recentSubmission) {
      return NextResponse.json(
        { error: 'You recently submitted a similar message. Please wait before submitting again.' },
        { status: 429 }
      );
    }

    // Create and save new contact
    const contact = new Contacts({
      ...data,
      ipAddress,
      source: 'website'
    });

    await contact.save();

    // Email failure should not block a successful submission
    try {
      await sendContactEmail(contact);
    } catch (emailError) {
      console.error("Contact email notification failed:", emailError);
    }

    return NextResponse.json(
      { success: true, data: contact },
      { status: 201 }
    );

  } catch (error) {
    console.error('Contact submission error:', error);

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

export const dynamic = 'force-dynamic';