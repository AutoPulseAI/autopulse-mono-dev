import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import Email from "@models/Email";
import Role from '@models/Role';
import Permission from '@models/Permission';
import User from '@models/User';
import jwt from 'jsonwebtoken';
import moment from 'moment-timezone';

export async function GET(request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const dealer_id = searchParams.get('dealer_id');
    const start_date = searchParams.get('start_date');
    const end_date = searchParams.get('end_date');
    const limit = parseInt(searchParams.get('limit')) || 10;
    let currentUser = null;
    
    if (!dealer_id) {
      return new Response(JSON.stringify({ error: 'Dealer ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get dealer timezone
    const dealer = await User.findById(dealer_id);
    const dealerTimezone = dealer?.dealer_account_information?.time_zone || 'America/New_York';
    try {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUser = await User.findById(decoded.userId).select('_id name email type');
        // Set message_by to user ID for authenticated users
        if (currentUser) {
          
        }else{
          return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
        }
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    } catch (err) {
      console.warn("Token verification failed in reply route:", err.message);
      // Continue without token - messageBy will remain null
    }

    // Create base query
    const query = { dealer_id };
    
    // Add date range if provided - convert from dealer timezone to UTC
    if (start_date && end_date) {
      // IMPORTANT: Convert UTC dates back to dealer timezone first to get correct calendar dates
      const startMomentInDealer = moment.utc(start_date).tz(dealerTimezone);
      const endMomentInDealer = moment.utc(end_date).tz(dealerTimezone);
      
      // Extract date part (YYYY-MM-DD) from dealer timezone
      const startDateStr = startMomentInDealer.format('YYYY-MM-DD');
      const endDateStr = endMomentInDealer.format('YYYY-MM-DD');
      
      // Create moment objects in dealer's timezone at start/end of day
      const startMoment = moment.tz(startDateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
      const endMoment = moment.tz(endDateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
      
      // Convert to UTC for MongoDB query - use $lte to include the entire end date
      query.date = {
        $gte: startMoment.utc().toDate(),
        $lte: endMoment.utc().toDate()
      };
    }

    const communications = await Email.find(query)
      .sort({ date: -1 })
      .limit(limit);

    return new Response(JSON.stringify(communications), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching communications:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch communications' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}