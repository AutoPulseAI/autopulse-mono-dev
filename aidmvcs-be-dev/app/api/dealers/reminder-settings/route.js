import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import User from "@models/User";


// GET: Get dealer's reminder settings
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dealerId = searchParams.get("dealer_id");
    
    if (!dealerId) {
      return NextResponse.json({ error: "Dealer ID is required" }, { status: 400 });
    }
    
    await dbConnect();
    const user = await User.findById(dealerId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get or create default reminder settings
    const defaultSettings = {
      enabled: true,
      total_reminders: 3,
      reminder_intervals: [24, 2, 1], // 24h, 2h, 1h before appointment
      reminder_type: "both",
      post_enabled: false,
      post_total_reminders: 1,
      post_intervals: [24],
      post_type: "both",
      // Managerial Review Settings
      review_enabled: true,
      review_frequency: [24, 72, 168], // 24h, 72h, 168h after status change
      review_type: "both"
    };
    
    const reminderSettings = {
      ...defaultSettings,
      ...user.appointment_reminder_settings,
      // Map managerial review settings to frontend expected field names
      review_enabled: user.managerial_review_settings?.enabled ?? defaultSettings.review_enabled,
      review_frequency: user.managerial_review_settings?.frequency ?? defaultSettings.review_frequency,
      review_type: user.managerial_review_settings?.communication_type ?? defaultSettings.review_type
    };

    return NextResponse.json({
      success: true,
      settings: reminderSettings
    });

  } catch (error) {
    console.error("Error getting reminder settings:", error);
    return NextResponse.json(
      { error: "Failed to get reminder settings" },
      { status: 500 }
    );
  }
}

// PUT: Update dealer's reminder settings
export async function PUT(req) {
  try {
    const body = await req.json();
    console.log('Received PUT body:', JSON.stringify(body, null, 2));
    
    const {
      dealer_id,
      enabled,
      total_reminders,
      reminder_intervals,
      reminder_type,
      post_enabled,
      post_total_reminders,
      post_intervals,
      post_type,
      // Managerial Review Settings
      review_enabled,
      review_frequency,
      review_type
    } = body;

    if (!dealer_id) {
      return NextResponse.json({ error: "Dealer ID is required" }, { status: 400 });
    }

    // Validate input
    if (total_reminders && (total_reminders < 1 || total_reminders > 10)) {
      return NextResponse.json(
        { error: "Total reminders must be between 1 and 10" },
        { status: 400 }
      );
    }

    if (reminder_intervals && total_reminders && reminder_intervals.length !== total_reminders) {
      return NextResponse.json(
        { error: "Reminder intervals count must match total reminders" },
        { status: 400 }
      );
    }

    if (reminder_intervals && reminder_intervals.some(interval => interval < 0.5 || interval > 168)) {
      return NextResponse.json(
        { error: "Reminder intervals must be between 0.5 and 168 hours" },
        { status: 400 }
      );
    }

    // Validate post settings if provided
    if (post_total_reminders && (post_total_reminders < 1 || post_total_reminders > 10)) {
      return NextResponse.json(
        { error: "Post reminders must be between 1 and 10" },
        { status: 400 }
      );
    }

    if (post_intervals && post_total_reminders && post_intervals.length !== post_total_reminders) {
      return NextResponse.json(
        { error: "Post reminder intervals count must match post total reminders" },
        { status: 400 }
      );
    }

    if (post_intervals && post_intervals.some(interval => interval < 1 || interval > 720)) {
      return NextResponse.json(
        { error: "Post reminder intervals must be between 1 and 720 hours" },
        { status: 400 }
      );
    }

    if (post_type && !["email", "sms", "both"].includes(post_type)) {
      return NextResponse.json(
        { error: "Post reminder type must be 'email', 'sms', or 'both'" },
        { status: 400 }
      );
    }

    if (reminder_type && !["email", "sms", "both"].includes(reminder_type)) {
      return NextResponse.json(
        { error: "Reminder type must be 'email', 'sms', or 'both'" },
        { status: 400 }
      );
    }

    // Validate managerial review settings if provided
    if (review_frequency && review_frequency.some(interval => interval < 1 || interval > 720)) {
      return NextResponse.json(
        { error: "Review frequency intervals must be between 1 and 720 hours" },
        { status: 400 }
      );
    }

    if (review_type && !["email", "sms", "both"].includes(review_type)) {
      return NextResponse.json(
        { error: "Review type must be 'email', 'sms', or 'both'" },
        { status: 400 }
      );
    }

    await dbConnect();
    
    const user = await User.findById(dealer_id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update appointment reminder settings
    user.appointment_reminder_settings = {
      ...user.appointment_reminder_settings,
      enabled: enabled !== undefined ? enabled : user.appointment_reminder_settings?.enabled ?? true,
      total_reminders: total_reminders !== undefined ? total_reminders : user.appointment_reminder_settings?.total_reminders ?? 3,
      reminder_intervals: reminder_intervals !== undefined ? reminder_intervals : user.appointment_reminder_settings?.reminder_intervals ?? [24, 2, 1],
      reminder_type: reminder_type !== undefined ? reminder_type : user.appointment_reminder_settings?.reminder_type ?? "both",
      post_enabled: post_enabled !== undefined ? post_enabled : user.appointment_reminder_settings?.post_enabled ?? false,
      post_total_reminders: post_total_reminders !== undefined ? post_total_reminders : user.appointment_reminder_settings?.post_total_reminders ?? 1,
      post_intervals: post_intervals !== undefined ? post_intervals : user.appointment_reminder_settings?.post_intervals ?? [24],
      post_type: post_type !== undefined ? post_type : user.appointment_reminder_settings?.post_type ?? "both"
    };

    // Update managerial review settings
    user.managerial_review_settings = {
      ...user.managerial_review_settings,
      enabled: review_enabled !== undefined ? review_enabled : user.managerial_review_settings?.enabled ?? true,
      frequency: review_frequency !== undefined ? review_frequency : user.managerial_review_settings?.frequency ?? [24, 72, 168],
      communication_type: review_type !== undefined ? review_type : user.managerial_review_settings?.communication_type ?? "both"
    };

    // Ensure Mongoose persists nested object changes
    user.markModified('appointment_reminder_settings');
    user.markModified('managerial_review_settings');

    await user.save();

    console.log('Saved appointment_reminder_settings:', JSON.stringify(user.appointment_reminder_settings, null, 2));
    console.log('Saved managerial_review_settings:', JSON.stringify(user.managerial_review_settings, null, 2));

    // Ensure all fields are included in response
    const responseSettings = {
      enabled: user.appointment_reminder_settings?.enabled ?? true,
      total_reminders: user.appointment_reminder_settings?.total_reminders ?? 3,
      reminder_intervals: user.appointment_reminder_settings?.reminder_intervals ?? [24, 2, 1],
      reminder_type: user.appointment_reminder_settings?.reminder_type ?? "both",
      post_enabled: user.appointment_reminder_settings?.post_enabled ?? false,
      post_total_reminders: user.appointment_reminder_settings?.post_total_reminders ?? 1,
      post_intervals: user.appointment_reminder_settings?.post_intervals ?? [24],
      post_type: user.appointment_reminder_settings?.post_type ?? "both",
      // Managerial Review Settings
      review_enabled: user.managerial_review_settings?.enabled ?? true,
      review_frequency: user.managerial_review_settings?.frequency ?? [24, 72, 168],
      review_type: user.managerial_review_settings?.communication_type ?? "both"
    };

    return NextResponse.json({
      success: true,
      message: "Reminder settings updated successfully",
      settings: responseSettings
    });

  } catch (error) {
    console.error("Error updating reminder settings:", error);
    return NextResponse.json(
      { error: "Failed to update reminder settings" },
      { status: 500 }
    );
  }
}
