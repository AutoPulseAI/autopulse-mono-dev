# Campaign Timezone Explanation

## How Campaign Scheduling Works

### The Simple Answer
**When you enter a time, the campaign runs at THAT EXACT TIME in YOUR timezone.**

### Example
- **You enter:** 18/11/2025 at 18:40 (6:40 PM)
- **Campaign executes:** 18/11/2025 at 18:40 in YOUR timezone
- **UTC conversion:** The system converts this to UTC for the server (e.g., 19/11/2025 at 05:10 UTC if you're in IST)

### Why UTC Conversion?
1. **Server runs in UTC** - Your server/cron jobs operate in UTC time
2. **Consistent execution** - All campaigns are stored in UTC for consistent processing
3. **Timezone independence** - Works correctly regardless of where your server is located

### The Flow

```
User Input (Your Timezone)
    ↓
18/11/2025 at 18:40 (IST)
    ↓
System converts to UTC
    ↓
19/11/2025 at 05:10 UTC (stored in database)
    ↓
Cron job checks: "Is it 05:10 UTC yet?"
    ↓
When it's 05:10 UTC → Campaign executes
    ↓
Result: Campaign runs at 18:40 in YOUR timezone ✅
```

### Important Points

1. **You always see YOUR time** - The input fields show the time you entered
2. **Campaign runs at YOUR time** - It executes at the exact time you specified in your timezone
3. **UTC is just technical** - The UTC conversion is only for the server to know when to execute
4. **No confusion needed** - Just enter the time you want, and it will run at that time!

### What Changed in the UI

- **Before:** Showed "UTC Time: 19/11/2025 at 05:10" (confusing)
- **After:** Shows "Campaign will run at: 18/11/2025 at 18:40 (your local timezone)" (clear!)

The UTC time is still shown but labeled as "Server time" for technical reference only.

### Summary

✅ **Enter time in your timezone** → Campaign runs at that time  
✅ **UTC conversion happens automatically** → For server execution  
✅ **You don't need to worry about UTC** → Just enter the time you want!

