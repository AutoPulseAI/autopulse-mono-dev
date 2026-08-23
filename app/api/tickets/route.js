import dbConnect from "@lib/mongodb";
import Ticket from "@models/Ticket";
import User from "@models/User"; // Import User model to check type
import Counter from "@models/Counter";
import { sendNewTicketAdminEmail } from "@lib/emailservice";
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get('user_id');
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 10;
    const skip = (page - 1) * limit;
    const subject = searchParams.get('subject');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // First check if user exists and get their type
    let userType = null;
    if (user_id) {
      const user = await User.findById(user_id).select('type');
      if (!user) {
        return Response.json(
          { success: false, message: 'User not found' },
          { status: 404 }
        );
      }
      userType = user.type;
    }

    // Build base query based on user type
    let query = {};
    if (user_id) {
      if (userType === 'admin') {
        // Admin can see all tickets - no filter needed
      } else {
        // Regular users can only see their own tickets
        query = {
          $or: [
            { createdBy: user_id },
            { assignedTo: user_id }
          ]
        };
      }
    }

    // Add search filters to the query
    if (subject) {
      query.title = { $regex: subject, $options: 'i' }; // Case-insensitive search
    }

    if (status) {
      query.status = status;
    }

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (startDate) {
      query.createdAt = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.createdAt = { $lte: new Date(endDate) };
    }

    const [tickets, count] = await Promise.all([
      Ticket.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate({
          path: 'createdBy',
          select: 'name role',
          model: 'User'
        })
        .populate({
          path: 'assignedTo',
          select: 'name role',
          model: 'User'
        })
        .populate({
          path: 'messages.sender',
          select: 'name role',
          model: 'User'
        }),
      Ticket.countDocuments(query)
    ]);

    return Response.json({
      success: true,
      data: tickets,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: limit
    });

  } catch (error) {
    console.error('Error fetching tickets:', error);
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    await dbConnect();
    
    const { title, description, category, priority, createdBy, createdByModel, attachments } = await request.json();
    
    console.log('Received ticket creation data:', {
      title,
      description: description ? description.substring(0, 100) + '...' : null,
      category,
      priority,
      createdBy,
      createdByModel,
      attachments: attachments ? attachments.length : 0,
      attachmentsType: typeof attachments,
      attachmentsSample: attachments ? attachments.slice(0, 2) : null
    });

    if (!title || !description || !category || !priority || !createdBy || !createdByModel) {
      return Response.json({
        success: false,
        message: "Missing required fields"
      }, { status: 400 });
    }

    // Validate category and priority
    const validCategories = ['technical', 'billing', 'account', 'general'];
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    
    if (!validCategories.includes(category)) {
      return Response.json({
        success: false,
        message: "Invalid category"
      }, { status: 400 });
    }
    
    if (!validPriorities.includes(priority)) {
      return Response.json({
        success: false,
        message: "Invalid priority"
      }, { status: 400 });
    }

    // Process attachments to extract URLs only
    console.log('Processing attachments:', attachments);
    const processedAttachments = attachments ? attachments.map(att => {
      const url = att.url || att.publicUrl || att.public_url || '';
      console.log('Processing attachment:', att, '-> URL:', url);
      return url;
    }).filter(url => url) : [];
    
    console.log('Final processed attachments:', processedAttachments);

    // Get next ticket number (sequential)
    const counter = await Counter.findOneAndUpdate(
      { name: 'ticket' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const ticketNumber = counter.seq;

    // Create ticket with processed attachments and ticket number
    const ticket = new Ticket({
      title,
      description,
      category,
      priority,
      createdBy,
      createdByModel,
      attachments: processedAttachments,
      ticketNumber
    });

    console.log('Ticket object before save:', {
      title: ticket.title,
      description: ticket.description,
      attachments: ticket.attachments,
      attachmentsLength: ticket.attachments.length
    });

    await ticket.save();

    console.log('Ticket after save:', {
      _id: ticket._id,
      attachments: ticket.attachments,
      attachmentsLength: ticket.attachments.length
    });

    // Notify admin (full content + attachments), creator (confirmation), and vendor if applicable
    try {
      const creatorDoc = await User.findById(ticket.createdBy).select('name email type vendor_id').lean();
      const creator = creatorDoc
        ? {
            name: creatorDoc.name ?? 'Unknown',
            email: creatorDoc.email ?? '',
            type: creatorDoc.type ?? createdByModel ?? 'user',
            vendor_id: creatorDoc.vendor_id ?? null
          }
        : { name: 'Unknown', email: '', type: createdByModel ?? 'user', vendor_id: null };

      await sendNewTicketAdminEmail(ticket, creator);
    } catch (notifyErr) {
      console.error('Error sending new-ticket notifications:', notifyErr);
      // Don't fail the request; ticket was created successfully
    }

    return Response.json({
      success: true,
      message: "Ticket created successfully",
      ticket
    });

  } catch (error) {
    console.error('Error creating ticket:', error);
    return Response.json({
      success: false,
      message: error.message
    }, { status: 500 });
  }
}