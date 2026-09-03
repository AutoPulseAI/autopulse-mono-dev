import dbConnect from "@lib/mongodb";
import Ticket from "@models/Ticket";
import User from "@models/User";
export const dynamic = 'force-dynamic';
import { sendTicketMessageEmail } from "@lib/emailservice";

export async function GET(req, { params }) {
  try {
    await dbConnect();
   
    const { id } = await params;
    const ticket = await Ticket.findById(id)
    .populate({
        path: 'messages.sender',
        select: 'name email',
        model: 'User' // Explicitly specify the model
      });

    if (!ticket) {
      return Response.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      );
    }

    // Check authorization
   

    return Response.json({ 
      success: true, 
      messages: ticket.messages 
    });
  } catch (error) {
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req, { params }) {
  try {
    await dbConnect();
   
    const { id } = await params;
    const body = await req.json();
    const { content, user_id, type, attachments } = body;
    
    console.log('Received message data:', {
      ticketId: id,
      content,
      user_id,
      type,
      attachments: attachments ? attachments.length : 0,
      attachmentsType: typeof attachments,
      attachmentsSample: attachments ? attachments.slice(0, 2) : null
    });

    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return Response.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      );
    }

    // Validate user_id is a valid ObjectId
    if (!user_id || typeof user_id !== 'string' || user_id.length !== 24) {
      return Response.json(
        { success: false, message: 'Invalid user_id format' },
        { status: 400 }
      );
    }

    // Process attachments to extract URLs only
    let processedAttachments = [];
    
    if (attachments && Array.isArray(attachments)) {
      console.log('Processing attachments array:', attachments);
      processedAttachments = attachments.map(att => 
        att.url || att.publicUrl || att.public_url || ''
      ).filter(url => url);
    } else if (attachments) {
      console.error('Attachments is not an array:', typeof attachments, attachments);
      console.error('Attachments value:', JSON.stringify(attachments, null, 2));
      return Response.json(
        { success: false, message: 'Attachments must be an array' },
        { status: 400 }
      );
    }

    console.log('Processed attachments:', processedAttachments);

    ticket.messages.push({
      sender: user_id,
      senderType: type,
      content,
      attachments: processedAttachments
    });

    await ticket.save();

    const sender = await User.findById(user_id);
    if (!sender) {
      throw new Error('Sender user not found');
    }

    // Send appropriate notifications based on sender type
    await sendTicketMessageEmail(
      ticket,
      sender,
      content
    );

    console.log(`Message added successfully with ${processedAttachments.length} attachments`);

    return Response.json({ 
      success: true, 
      message: "Message added successfully"
    });
  } catch (error) {
    console.error('Error in POST /api/tickets/[id]/messages:', error);
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}