import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import jwt from "jsonwebtoken";

export const dynamic = 'force-dynamic';

/**
 * Get read/unread message statistics for a dealer
 * GET /api/conversations/message-stats?dealer_id=xxx
 * Returns total read, unread counts (not affected by date filter)
 */
export async function GET(req) {
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
    
    const { searchParams } = new URL(req.url);
    const dealer_id = searchParams.get('dealer_id');
    
    if (!dealer_id) {
      return Response.json(
        { success: false, message: 'dealer_id is required' },
        { status: 400 }
      );
    }
    
    // Count unread messages (all messages with lead_id, regardless of status)
    const unreadCount = await Email.countDocuments({
      dealer_id: dealer_id,
      lead_id: { $exists: true, $ne: null },
      read: { $ne: true }
    });
    
    // Count read messages (all messages with lead_id, regardless of status)
    const readCount = await Email.countDocuments({
      dealer_id: dealer_id,
      lead_id: { $exists: true, $ne: null },
      read: true
    });
    
    // Total messages with lead_id
    const totalIncoming = unreadCount + readCount;
    
    return Response.json({ 
      success: true, 
      unread_count: unreadCount,
      read_count: readCount,
      total_incoming: totalIncoming
    });
  } catch (error) {
    console.error('Error fetching message stats:', error);
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
