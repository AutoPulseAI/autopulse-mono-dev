import dbConnect from "@lib/mongodb";
import ReportSchedule from "@models/ReportSchedule";
import User from "@models/User";

export async function GET(req) {
  try {
    console.log("GET request received for report settings");
    
    await dbConnect();
    console.log("Database connected successfully");
    
    const { searchParams } = new URL(req.url);
    const dealerId = searchParams.get("dealer_id");
    
    console.log("Looking for dealer_id:", dealerId);

    if (!dealerId) {
      console.log("No dealer_id provided");
      return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if dealer exists
    console.log("Looking for dealer with ID:", dealerId);
    const dealer = await User.findById(dealerId);
    if (!dealer) {
      console.log("Dealer not found:", dealerId);
      return new Response(JSON.stringify({ message: "Dealer not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.log("Dealer found:", dealer.name);

    // Get user settings (schedules are stored here)
    const userSettings = dealer.report_schedule_settings || {};
    const schedules = userSettings.schedules || [];
    
    console.log("User settings found:", {
      enabled: userSettings.enabled,
      schedulesCount: schedules.length
    });
    
    if (schedules.length === 0) {
      console.log("No schedules found, returning default");
      return new Response(JSON.stringify({ 
        message: "No schedules found",
        dealer_id: dealerId,
        userSettings: {
          enabled: false,
          default_email: dealer.email || "",
          timezone: "America/New_York",
          schedules: [],
          include_metrics: {
            leads: true,
            conversations: true,
            vehicles: true,
            revenue: true
          },
          custom_message: "",
          last_settings_updated: null
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get execution records for status tracking
    const executionRecords = await ReportSchedule.find({ dealer_id: dealerId });
    console.log("Execution records found:", executionRecords.length);
    
    // Map execution records to schedules for status
    const schedulesWithStatus = schedules.map(schedule => {
      const executionRecord = executionRecords.find(er => er.schedule_id === schedule.id);
      return {
        ...schedule,
        status: executionRecord ? executionRecord.status : 'pending',
        nextExecution: executionRecord ? executionRecord.scheduledAt : null,
        lastSent: executionRecord ? executionRecord.sentAt : null
      };
    });

    console.log("Returning schedules with status:", schedulesWithStatus.length);
    
    return new Response(JSON.stringify({
      userSettings: {
        ...userSettings,
        schedules: schedulesWithStatus
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("GET report settings error:", error);
    return new Response(JSON.stringify({ 
      message: "Error fetching report settings", 
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function PUT(req) {
  try {
    console.log("PUT request received for report settings");
    
    await dbConnect();
    console.log("Database connected successfully");
    
    const requestBody = await req.json();
    console.log("Request body:", JSON.stringify(requestBody, null, 2));
    
    const { dealerId, schedules, reportEmail, timezone, includeMetrics, customMessage, isActive } = requestBody;

    if (!dealerId || !reportEmail) {
      console.log("Missing required fields:", { dealerId, reportEmail });
      return new Response(JSON.stringify({ message: "Dealer ID and report email are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate email(s) - support comma-separated emails
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailAddresses = reportEmail.split(',').map(email => email.trim()).filter(email => email.length > 0);
    
    if (emailAddresses.length === 0) {
      console.log("No valid email addresses provided:", reportEmail);
      return new Response(JSON.stringify({ message: "At least one email address is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // Validate each email
    const invalidEmails = emailAddresses.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      console.log("Invalid email format(s):", invalidEmails);
      return new Response(JSON.stringify({ 
        message: `Invalid email address(es): ${invalidEmails.join(', ')}` 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // Store comma-separated emails as-is (will be split when sending)
    // Normalize to comma-space format for consistency
    const validatedEmailString = emailAddresses.join(', ');

    console.log("Looking for dealer with ID:", dealerId);
    const dealer = await User.findById(dealerId);
    if (!dealer) {
      console.log("Dealer not found:", dealerId);
      return new Response(JSON.stringify({ message: "Dealer not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.log("Dealer found:", dealer.name);

    // Validate schedules
    if (schedules && Array.isArray(schedules)) {
      const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      const validMonths = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      const validFrequencies = ["daily", "weekly", "monthly", "yearly"];

      console.log("Received schedules:", JSON.stringify(schedules, null, 2));

      // Check for duplicate frequencies first
      const frequencyCounts = {};
      const activeSchedules = schedules.filter(s => s.active);
      
      console.log("Active schedules:", activeSchedules.length);
      
      activeSchedules.forEach(schedule => {
        const frequency = schedule.frequency || schedule.reportType;
        if (frequency) {
          frequencyCounts[frequency] = (frequencyCounts[frequency] || 0) + 1;
          console.log(`Frequency ${frequency}: count ${frequencyCounts[frequency]}`);
        }
      });

      console.log("Frequency counts:", frequencyCounts);

      // Validate only one schedule per frequency type
      for (const [frequency, count] of Object.entries(frequencyCounts)) {
        if (count > 1) {
          console.log(`DUPLICATE FREQUENCY DETECTED: ${frequency} has ${count} schedules`);
          return new Response(JSON.stringify({
            message: `Only one schedule allowed per frequency type. You have ${count} schedules for ${frequency}.`
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Validate individual schedules
      for (const schedule of schedules) {
        if (!schedule.active) continue;

        // Validate frequency
        const frequency = schedule.frequency || schedule.reportType;
        if (!frequency) {
          console.log("Missing frequency for schedule:", schedule);
          return new Response(JSON.stringify({
            message: `Frequency is required for active schedules.`
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!validFrequencies.includes(frequency)) {
          console.log("Invalid frequency:", frequency);
          return new Response(JSON.stringify({
            message: `Invalid frequency: ${frequency}. Must be one of: ${validFrequencies.join(", ")}`
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Validate days array based on frequency
        if (frequency === 'daily') {
          // Daily schedules don't need specific days - they run every day
          if (schedule.days && Array.isArray(schedule.days) && schedule.days.length > 0) {
            console.log("Daily schedule has days selected:", schedule.days);
            return new Response(JSON.stringify({
              message: `Daily schedules don't need specific days selected. They run every day automatically.`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        } else if (frequency === 'weekly') {
          // Weekly schedules need exactly one day name
          if (!schedule.days || !Array.isArray(schedule.days) || schedule.days.length !== 1) {
            console.log("Weekly schedule must have exactly one day:", schedule.days);
            return new Response(JSON.stringify({
              message: `Weekly schedules must have exactly one day selected.`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          
          const day = schedule.days[0];
          if (!day || typeof day !== 'string' || !validDays.includes(day.toLowerCase())) {
            console.log("Invalid day for weekly schedule:", day);
            return new Response(JSON.stringify({
              message: `Invalid day for weekly schedule: ${day}. Must be one of: ${validDays.join(", ")}`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        } else if (frequency === 'monthly') {
          // Monthly schedules need exactly one date number (1-31)
          if (!schedule.days || !Array.isArray(schedule.days) || schedule.days.length !== 1) {
            console.log("Monthly schedule must have exactly one date:", schedule.days);
            return new Response(JSON.stringify({
              message: `Monthly schedules must have exactly one date selected (1-31).`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          
          const date = schedule.days[0];
          if (!date || typeof date !== 'string' || isNaN(parseInt(date)) || parseInt(date) < 1 || parseInt(date) > 31) {
            console.log("Invalid date for monthly schedule:", date);
            return new Response(JSON.stringify({
              message: `Invalid date for monthly schedule: ${date}. Must be a number between 1 and 31.`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        } else if (frequency === 'yearly') {
          // Yearly schedules need exactly two values: month and date
          if (!schedule.days || !Array.isArray(schedule.days) || schedule.days.length !== 2) {
            console.log("Yearly schedule must have month and date:", schedule.days);
            return new Response(JSON.stringify({
              message: `Yearly schedules must have both month and date selected.`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          
          const month = schedule.days[0];
          const date = schedule.days[1];
          
          if (!month || typeof month !== 'string' || !validMonths.includes(month.toLowerCase())) {
            console.log("Invalid month for yearly schedule:", month);
            return new Response(JSON.stringify({
              message: `Invalid month for yearly schedule: ${month}. Must be one of: ${validMonths.join(", ")}`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          
          if (!date || typeof date !== 'string' || isNaN(parseInt(date)) || parseInt(date) < 1 || parseInt(date) > 31) {
            console.log("Invalid date for yearly schedule:", date);
            return new Response(JSON.stringify({
              message: `Invalid date for yearly schedule: ${date}. Must be a number between 1 and 31.`
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Validate time
        if (!schedule.time || typeof schedule.time !== 'string') {
          console.log("Missing or invalid time:", schedule.time);
          return new Response(JSON.stringify({
            message: `Invalid time value: ${schedule.time}. Time must be a valid string in HH:MM format.`
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(schedule.time)) {
          console.log("Invalid time format:", schedule.time);
          return new Response(JSON.stringify({
            message: `Invalid time format: ${schedule.time}. Must be in HH:MM format (e.g., 09:00, 14:30).`
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }

    // Get user's timezone from dealer_account_information
    const userTimezone = dealer.dealer_account_information?.time_zone || timezone || "America/New_York";
    console.log("Using timezone:", userTimezone, "from dealer account info:", dealer.dealer_account_information?.time_zone);

    // Update User model with complete report schedule settings
    const userUpdateData = {
      "report_schedule_settings.enabled": isActive !== undefined ? isActive : true,
      "report_schedule_settings.default_email": validatedEmailString,
      "report_schedule_settings.timezone": userTimezone,
      "report_schedule_settings.schedules": schedules || [],
      "report_schedule_settings.include_metrics": includeMetrics || {
        leads: true,
        conversations: true,
        vehicles: true,
        revenue: true
      },
      "report_schedule_settings.custom_message": customMessage || "",
      "report_schedule_settings.last_settings_updated": new Date()
    };

    console.log("Updating user with report settings:", JSON.stringify(userUpdateData, null, 2));
    
    const updatedUser = await User.findByIdAndUpdate(
      dealerId,
      { $set: userUpdateData },
      { new: true, runValidators: true }
    );

    console.log("User updated successfully");

    // Clear existing execution records for this dealer
    await ReportSchedule.deleteMany({ dealer_id: dealerId });
    console.log("Cleared existing execution records");

    // Create execution records for active schedules (like FollowUpJob)
    const executionRecords = [];
    
    if (schedules && Array.isArray(schedules)) {
      for (const schedule of schedules) {
        if (!schedule.active) continue;
        
        const frequency = schedule.frequency || schedule.reportType;
        
        // Calculate next execution time with user's timezone
        const nextExecutionTime = calculateNextExecutionTime(frequency, schedule.days, schedule.time, userTimezone);
        
        if (nextExecutionTime) {
          const executionData = {
            dealer_id: dealerId,
            schedule_id: schedule.id,
            frequency: frequency,
            scheduledAt: nextExecutionTime,
            status: "pending",
            report_data: {
              email: reportEmail,
              timezone: timezone || "America/New_York",
              include_metrics: includeMetrics || {
                leads: true,
                conversations: true,
                vehicles: true,
                revenue: true
              },
              custom_message: customMessage || ""
            }
          };
          
          console.log(`Creating execution record for ${frequency}:`, JSON.stringify(executionData, null, 2));
          
          const newExecution = new ReportSchedule(executionData);
          const savedExecution = await newExecution.save();
          executionRecords.push(savedExecution);
          
          console.log(`Execution record for ${frequency} created with ID:`, savedExecution._id);
        }
      }
    }

    console.log(`Total execution records created: ${executionRecords.length}`);

    return new Response(JSON.stringify({
      message: "Report settings saved successfully",
      userSettings: updatedUser.report_schedule_settings,
      executionRecords: executionRecords
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("PUT report settings error:", error);
    return new Response(JSON.stringify({
      message: "Error saving report settings",
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Helper function to calculate next execution time with timezone support
function calculateNextExecutionTime(frequency, days, time, userTimezone = "America/New_York") {
  try {
    // Get current time in user's timezone
    const now = new Date();
    const userTime = new Date(now.toLocaleString("en-US", { timeZone: userTimezone }));
    
    // Parse the scheduled time
    const [hours, minutes] = time.split(':');
    
    // Create the next execution time in user's timezone
    let nextTime = new Date(userTime);
    nextTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    // Always schedule for upcoming dates, never immediate
    if (frequency === 'daily') {
      // Daily: Schedule for tomorrow if time has passed today
      if (nextTime <= userTime) {
        nextTime.setDate(nextTime.getDate() + 1);
      }
    } else if (frequency === 'weekly' && days && days.length > 0) {
      // Weekly: Find next occurrence of the selected day
      const targetDay = days[0];
      const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
      const targetDayNum = dayMap[targetDay.toLowerCase()];
      
      // Calculate days to add to reach the target day
      let daysToAdd = (targetDayNum - userTime.getDay() + 7) % 7;
      
      // If it's the same day, schedule for next week
      if (daysToAdd === 0) {
        daysToAdd = 7;
      }
      
      // If time has passed today, add the calculated days
      if (nextTime <= userTime) {
        nextTime.setDate(nextTime.getDate() + daysToAdd);
      } else {
        // Time hasn't passed, but we still want to schedule for the upcoming occurrence
        nextTime.setDate(nextTime.getDate() + daysToAdd);
      }
    } else if (frequency === 'monthly' && days && days.length > 0) {
      // Monthly: Schedule for the specific date of next month
      const targetDate = parseInt(days[0]);
      
      // Start with next month
      nextTime.setMonth(nextTime.getMonth() + 1);
      nextTime.setDate(targetDate);
      
      // If this month's date has passed, we're already in next month
      // If not, we're scheduling for the upcoming month
    } else if (frequency === 'yearly' && days && days.length > 1) {
      // Yearly: Schedule for the specific month and date of next year
      const month = days[0];
      const targetDate = parseInt(days[1]);
      const monthMap = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      
      // Always schedule for next year to ensure it's upcoming
      nextTime.setFullYear(nextTime.getFullYear() + 1);
      nextTime.setMonth(monthMap[month.toLowerCase()], targetDate);
    }
    
    console.log(`📅 Scheduled ${frequency} report for:`, {
      userTimezone,
      scheduledTime: nextTime.toISOString(),
      localTime: nextTime.toLocaleString("en-US", { timeZone: userTimezone }),
      frequency,
      days,
      time
    });
    
    return nextTime;
  } catch (error) {
    console.error('Error calculating next execution time:', error);
    return null;
  }
}

export async function POST() {
  try {
    console.log("POST request received for testing report settings");
    
    await dbConnect();
    console.log("Database connected successfully");
    
    // Test creating a simple document
    const testData = {
      dealer_id: "68a492f8afa4e1d9f66972c6", // Use your dealer ID
      frequency: "daily",
      time: "09:00",
      is_active: true,
      status: "pending",
      report_email: "test@example.com",
      timezone: "America/New_York",
      include_metrics: {
        leads: true,
        conversations: true,
        vehicles: true,
        revenue: true
      },
      custom_message: "Test message"
    };
    
    console.log("Attempting to create test document:", JSON.stringify(testData, null, 2));
    
    const testDocument = new ReportSchedule(testData);
    const savedTest = await testDocument.save();
    
    console.log("Test document created successfully:", savedTest._id);
    
    // Clean up - delete the test document
    await ReportSchedule.findByIdAndDelete(savedTest._id);
    console.log("Test document cleaned up");
    
    return new Response(JSON.stringify({
      message: "Test successful - ReportSchedule model is working",
      testId: savedTest._id
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    
  } catch (error) {
    console.error("POST test error:", error);
    return new Response(JSON.stringify({
      message: "Test failed",
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
