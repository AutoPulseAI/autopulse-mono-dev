import { NextResponse } from 'next/server';
import { checkLeadByIdentifiers } from '../../../lib/dealersocket-worknote.js';

export async function POST(request) {
  try {
    const body = await request.json();
    
    // Validate required fields
    const { dealer_id, vendor_id, entity_email, entity_phone, vin, auto_insert_work_note = true, vendor_name = 'DealerSocket' } = body;
    
    if (!dealer_id) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'dealer_id is required' 
        },
        { status: 400 }
      );
    }
    
    if (!entity_email && !entity_phone) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Either entity_email or entity_phone is required' 
        },
        { status: 400 }
      );
    }
    
    // Call the checkLeadByIdentifiers function
    const result = await checkLeadByIdentifiers({
      dealer_id,
      vendor_id,
      entity_email,
      entity_phone,
      vin,
      auto_insert_work_note,
      vendor_name
    });
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Error in check lead API:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error',
        error: error.message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  return NextResponse.json(
    { 
      message: 'Use POST method to check leads',
      examples: {
        with_email: {
          dealer_id: '7250',
          entity_email: 'sarahfranich@icloud.com',
          vin: 'your_vin_number' // Optional
        },
        with_phone: {
          dealer_id: '7250',
          entity_phone: '+1-555-123-4567',
          vin: 'your_vin_number' // Optional
        },
        without_vin: {
          dealer_id: '7250',
          entity_email: 'sarahfranich@icloud.com'
        },
        with_work_note: {
          dealer_id: '7250',
          entity_email: 'sarahfranich@icloud.com',
          auto_insert_work_note: true,
          vendor_name: 'YourVendorName'
        }
      },
      note: 'vendor_id is optional, vin is optional, auto_insert_work_note defaults to true, vendor_name defaults to "DealerSocket"'
    },
    { status: 200 }
  );
}
