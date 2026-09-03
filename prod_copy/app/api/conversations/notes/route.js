import { NextResponse } from 'next/server';
import Email from '@models/Email';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import User from '@models/User';
import { checkLeadByIdentifiers } from '@lib/dealersocket-worknote.js';
import jwt from 'jsonwebtoken';

function normalizeUserLanguage(raw) {
  const v = raw == null ? '' : String(raw).trim();
  return v ? v.toLowerCase() : 'english';
}

export async function POST(request) {
  try {
    await dbConnect();

    // Extract token from Authorization header
    let currentUser = null;
    let messageBy = null; // Default to null (system message)
    
    try {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
         currentUser = await User.findById(decoded.userId).select('_id name email type');
        // Set message_by to user ID for authenticated users
        if (currentUser) {
          messageBy = currentUser._id;
        }else{
          return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
        }
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    } catch (err) {
      console.warn("Token verification failed in notes POST route:", err.message);
      // Continue without token - messageBy will remain null
    }

    const {
      lead_id,
      parent_conversation_id,
      content,
      dealer_id,
      internal_use,
      user_language
    } = await request.json();

    // Validate required fields
    if (!lead_id || !content || !dealer_id) {
      return NextResponse.json(
        { message: 'Missing required fields: lead_id, content, dealer_id' },
        { status: 400 }
      );
    }

    // Find the last message in the lead's conversation thread
    let parentMessageId = null;
    let sender = null;
    let recipient = null;
    let communication_type = 'email';
    let parentEmail = null;
    try {
      // First find the parent email for this lead
       parentEmail = await Email.findOne({ 
        parent_message_id: parent_conversation_id,
        is_note: false,
      }).sort({ 
        timestamp: -1,
        _id: -1
      });
      if(!parentEmail){
        parentEmail = await Email.findOne({ 
          message_id: parent_conversation_id,
          is_note: false,
        }).sort({ 
          timestamp: -1,
          _id: -1
        });
      }

      if (parentEmail) {
        parentMessageId = parentEmail.message_id || parentEmail._id.toString();
        sender = parentEmail.sender;
        recipient = parentEmail.recipient;
         communication_type = parentEmail.communication_type;
      }
    } catch (error) {
      console.error('Error finding parent message:', error);
    }

    // Create note entry in Email model with special fields
    const leadDoc = await Lead.findById(lead_id).select('user_language');
    const leadUserLanguageRaw = normalizeUserLanguage(user_language || leadDoc?.user_language);

    const note = new Email({
      sender: sender,
      recipient: recipient,
      subject: 'Lead Note',
      mail_content: content,
      dealer_id: dealer_id,
      lead_id: lead_id,
      parent_message_id: parent_conversation_id,
      parent_conversation_id: parentMessageId,
      status: 'sent',
      communication_type: communication_type,
      timestamp: new Date(),
      is_note: true,
      message_id: "note_"+Date.now(),
      message_by: messageBy, // Set user ID if authenticated
      internal_use: internal_use === true || internal_use === 'true', // Store internal_use flag
      user_language: leadUserLanguageRaw,
    });

    await note.save();

    // DealerSocket work note insert (best-effort)
    try {
      const updatedLead = await Lead.findById(lead_id);
      const updatedDealer = await User.findById(dealer_id);
      if (
        updatedLead &&
        updatedDealer?.dealer_account_information?.dealersocket_dealerid
      ) {
        const workNoteCriteria = {
          lead_id: updatedLead._id?.toString(),
          dealer_id: updatedDealer.dealer_account_information.dealersocket_dealerid,
          frenchise_id: updatedDealer.dealer_account_information.dealersocket_frenchiseid,
          entity_email: updatedLead.email || note?.sender,
          entity_phone: updatedLead.phone || note?.recipient,
          vin: updatedLead.vin || null,
          auto_insert_work_note: true,
          vendor_name: 'AutoPulse'
        };
        console.log('DealerSocket work note criteria (note):', workNoteCriteria);
        const workNoteResult = await checkLeadByIdentifiers(workNoteCriteria);
        if (workNoteResult.success && workNoteResult.found) {
          console.log('DealerSocket work note inserted (note):', workNoteResult.work_notes);
        } else {
          console.log('DealerSocket work note not inserted (note)');
        }
      }
    } catch (dsErr) {
      console.warn('DealerSocket work note insert failed (note):', dsErr?.message || dsErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Note saved successfully',
      note: note
    }, { status: 201 });

  } catch (error) {
    console.error('Error saving note:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const lead_id = searchParams.get('lead_id');
    const dealer_id = searchParams.get('dealer_id');

    if (!lead_id || !dealer_id) {
      return NextResponse.json(
        { message: 'Missing required parameters: lead_id, dealer_id' },
        { status: 400 }
      );
    }

    // Find all notes for this lead
    const notes = await Email.find({
      lead_id: lead_id,
      dealer_id: dealer_id,
      is_note: true
    }).sort({ timestamp: -1 });

    return NextResponse.json({
      success: true,
      notes: notes
    }, { status: 200 });

  } catch (error) {
    console.error('Error fetching notes:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    await dbConnect();

    // Extract token from Authorization header
    let currentUser = null;
    let messageBy = null; // Default to null (keep original if not authenticated)
    
    try {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
         currentUser = await User.findById(decoded.userId).select('_id name email type');
        // Set message_by to user ID for authenticated users (who edited)
        if (currentUser) {
          messageBy = currentUser._id;
        }
      }
    } catch (err) {
      console.warn("Token verification failed in notes PUT route:", err.message);
      // Continue without token - messageBy will remain null (keep original)
    }

    const {
      note_id,
      content,
      dealer_id,
      internal_use,
      user_language
    } = await request.json();

    // Validate required fields
    if (!note_id || !content || !dealer_id) {
      return NextResponse.json(
        { message: 'Missing required fields: note_id, content, dealer_id' },
        { status: 400 }
      );
    }

    // Find and update the note
    const note = await Email.findOne({
      _id: note_id,
      dealer_id: dealer_id,
      is_note: true
    });

    if (!note) {
      return NextResponse.json(
        { message: 'Note not found or unauthorized' },
        { status: 404 }
      );
    }

    // Update the note content
    note.mail_content = content.trim();
    note.timestamp = new Date(); // Update timestamp
    // Update internal_use if provided
    if (internal_use !== undefined) {
      note.internal_use = internal_use === true || internal_use === 'true';
    }
    if (user_language !== undefined) {
      note.user_language = normalizeUserLanguage(user_language);
    }
    // Update message_by if user is authenticated (to track who edited it)
    if (messageBy) {
      note.message_by = messageBy;
    }
    await note.save();

    return NextResponse.json({
      success: true,
      message: 'Note updated successfully',
      note: note
    }, { status: 200 });

  } catch (error) {
    console.error('Error updating note:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const note_id = searchParams.get('note_id');
    const dealer_id = searchParams.get('dealer_id');

    if (!note_id || !dealer_id) {
      return NextResponse.json(
        { message: 'Missing required parameters: note_id, dealer_id' },
        { status: 400 }
      );
    }

    // Delete the note
    const result = await Email.deleteOne({
      _id: note_id,
      dealer_id: dealer_id,
      is_note: true
    });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { message: 'Note not found or unauthorized' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Note deleted successfully'
    }, { status: 200 });

  } catch (error) {
    console.error('Error deleting note:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error.message },
      { status: 500 }
    );
  }
}
