// app/api/contacts/[id]/status/route.js
import { NextResponse } from 'next/server';
import { Contacts } from '@models/Contacts';
import dbConnect from "@lib/mongodb";

export async function PATCH(request, { params }) {
  try {
    await dbConnect();
    const { id } = await params;

    const { status } = await request.json();

    if (!['new', 'in-progress', 'resolved'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    const contact = await Contacts.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).lean();
    
    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: contact
    });
    
  } catch (error) {
    console.error('Error updating contact status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';