import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import jwt from "jsonwebtoken";

export const dynamic = 'force-dynamic';

/**
 * Mark all messages in a lead's conversation as read
 * POST /api/conversations/mark-read
 * Body: { lead_id: string }
 */
export async function POST(req) {
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
    let userId, userType;
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
      userType = decoded.type; // 'admin', 'dealer', or 'vendor'
    } catch (err) {
      return Response.json(
        { success: false, message: 'Invalid or expired token' },
        { status: 401 }
      );
    }
    
    const { lead_id } = await req.json();
    
    if (!lead_id) {
      return Response.json(
        { success: false, message: 'lead_id is required' },
        { status: 400 }
      );
    }
    
    // Mark all messages for this lead as read
    const result = await Email.updateMany(
      { 
        lead_id: lead_id,
        read: { $ne: true } // Only update unread messages
      },
      { 
        $set: { 
          read: true,
          read_by: userId,
          read_at: new Date()
        } 
      }
    );
    
    return Response.json({ 
      success: true, 
      message: 'Messages marked as read',
      modified_count: result.modifiedCount
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
