import { NextResponse } from "next/server";
import moment from "moment-timezone";

// POST: Convert date/time from dealer timezone to UTC
export async function POST(req) {
  try {
    const { dateTime, timezone } = await req.json();
    
    if (!dateTime || !timezone) {
      return NextResponse.json(
        { error: "dateTime and timezone are required" },
        { status: 400 }
      );
    }
    
    // Parse the dateTime string (format: "YYYY-MM-DDTHH:mm:ss" or "YYYY-MM-DD HH:mm:ss")
    let dateTimeStr = dateTime;
    if (dateTimeStr.includes('T')) {
      dateTimeStr = dateTimeStr.replace('T', ' ');
    }
    
    // Remove seconds if present
    if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
      dateTimeStr = dateTimeStr.substring(0, 16); // Remove seconds
    }
    
    // Create a moment in dealer's timezone
    const momentDate = moment.tz(dateTimeStr, "YYYY-MM-DD HH:mm", timezone);
    
    if (!momentDate.isValid()) {
      return NextResponse.json(
        { error: "Invalid date/time format" },
        { status: 400 }
      );
    }
    
    // Convert to UTC
    const utcDate = momentDate.utc().toDate();
    
    return NextResponse.json({
      success: true,
      utcDate: utcDate.toISOString(),
      utcTimestamp: utcDate.getTime()
    });
    
  } catch (error) {
    console.error("Error converting timezone:", error);
    return NextResponse.json(
      { error: error.message || "Failed to convert timezone" },
      { status: 500 }
    );
  }
}

