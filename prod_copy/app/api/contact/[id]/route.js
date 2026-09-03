// app/api/contacts/[id]/route.js
import { NextResponse } from 'next/server';
import { Contacts } from '@models/Contacts';
import dbConnect from "@lib/mongodb";

export async function GET(request, { params }) {
  try {
    await dbConnect();
    
    const contact = await Contacts.findById(params.id).lean();
    
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
    console.error('Error fetching contact:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
    try {
      await dbConnect();
      
      const contact = await Contacts.findByIdAndDelete(params.id);
     
    
     
      return NextResponse.json({
        success: true,
        
      });
      
    } catch (error) {
      console.error('Error fetching contact:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  }

export const dynamic = 'force-dynamic';