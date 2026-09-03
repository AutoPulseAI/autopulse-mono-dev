import dbConnect from "@lib/mongodb";
import Ticket from "@models/Ticket";
import jwt from "jsonwebtoken";

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  try {
    await dbConnect();
    const { id } = await params;
    const ticket = await Ticket.findById(id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email')
      .populate('messages.sender', 'name email');

    if (!ticket) {
      return Response.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      );
    }

    return Response.json({ success: true, data: ticket });
  } catch (error) {
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(req, { params }) {
  try {
    await dbConnect();

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return Response.json(
        { success: false, message: "No authorization token provided" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    let userId, type;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
      type = decoded.type;
    } catch (err) {
      return Response.json(
        { success: false, message: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await req.json();
    const { title, description, category, priority, status } = body;

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return Response.json(
        { success: false, message: "Ticket not found" },
        { status: 404 }
      );
    }

    const isCreator = ticket.createdBy?.equals(userId);
    const isAssigned = ticket.assignedTo?.equals(userId);
    const isAdmin = type === "admin";
    const isVendor = type === "vendor";

    if (!isCreator && !isAssigned && !isAdmin && !isVendor) {
      return Response.json(
        { success: false, message: "Not authorized" },
        { status: 403 }
      );
    }

    // Only admin can update priority and category
    if (title) ticket.title = title;
    if (description) ticket.description = description;
    if (status) ticket.status = status;
    if (isAdmin) {
      if (category) ticket.category = category;
      if (priority) ticket.priority = priority;
    }

    await ticket.save();

    return Response.json({ success: true, data: ticket });
  } catch (error) {
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req, { params }) {
  try {
    await dbConnect();
   
    // Await params in Next.js 15+
    const { id } = await params;
    
    const ticket = await Ticket.findByIdAndDelete(id);

    if (!ticket) {
      return Response.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      );
    }

    return Response.json({ success: true, message: 'Ticket deleted' });
  } catch (error) {
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}