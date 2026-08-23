import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import jwt from "jsonwebtoken";

export const dynamic = 'force-dynamic';

/**
 * Get unread message count for a dealer
 * GET /api/conversations/unread-count?dealer_id=xxx
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
    
    // Count unread messages for this dealer
    // Count all messages with lead_id (both incoming and sent)
    const unreadCount = await Email.countDocuments({
      dealer_id: dealer_id,
      lead_id: { $exists: true, $ne: null },
      read: { $ne: true }
    });
    
    return Response.json({ 
      success: true, 
      unread_count: unreadCount
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    return Response.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
