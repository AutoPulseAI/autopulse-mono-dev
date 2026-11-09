// app/api/contacts/[id]/route.js
import { NextResponse } from 'next/server';
import { Contacts } from '@models/Contacts';
import dbConnect from "@lib/mongodb";
import { requireSuperAdmin } from "@lib/apiGuard";

export async function GET(request, { params }) {
  // Security fix (Nov 2026): the admin inbox (contact / demo requests) is super admin only; the public form POST stays open.
  const guard = await requireSuperAdmin(request);
  if (guard.response) return guard.response;
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
  // Security fix (Nov 2026): the admin inbox (contact / demo requests) is super admin only; the public form POST stays open.
  const guard = await requireSuperAdmin(request);
  if (guard.response) return guard.response;
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