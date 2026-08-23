import dbConnect from "@lib/mongodb";
import Ticket from "@models/Ticket";
import User from "@models/User";
import { sendTicketMessageEmail } from "@lib/emailservice";
import jwt from 'jsonwebtoken';
export const dynamic = 'force-dynamic';

export async function PUT(req, { params }) {
  try {
    await dbConnect();
    
    // Extract and verify JWT token from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return Response.json(
        { success: false, message: 'No authorization token provided' },
        { status: 401 }
      );
    }
    
    const token = authHeader.split(" ")[1];
    let user_id, type;
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      user_id = decoded.userId;
      type = decoded.type; // 'admin', 'dealer', or 'vendor'
    } catch (err) {
      return Response.json(
        { success: false, message: 'Invalid or expired token' },
        { status: 401 }
      );
    }
    
    const { id } = await params;
    const { status } = await req.json();
    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return Response.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      );
    }

    // Check authorization (ticket creator, assigned support staff, admins, or vendors can update status)
    const isCreator = ticket.createdBy?.equals(user_id);
    const isAssigned = ticket.assignedTo?.equals(user_id);
    const isAdmin = type === 'admin';
    const isVendor = type === 'vendor';
    
    if (!isCreator && !isAssigned && !isAdmin && !isVendor) {
      return Response.json(
        { success: false, message: 'Not authorized' },
        { status: 403 }
      );
    }

    ticket.status = status;
    await ticket.save();

    const sender = await User.findById(user_id);
        if (!sender) {
          throw new Error('Sender user not found');
    }
   const content = `Your ticket status has been updated to "${status}". 
  
      Ticket Details:
      - Title: ${ticket.title}
      - Category: ${ticket.category}
      - Priority: ${ticket.priority}
      - Status: ${status}
      - Last Updated: ${new Date().toLocaleString()}

      You can view the ticket and add additional comments by visiting the support portal. 
      `;
    await sendTicketMessageEmail(
          ticket,
          sender,
          content
        );

    return Response.json({
      success: true,
      message: "Status updated successfully"
    });
  } catch (error) {
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}