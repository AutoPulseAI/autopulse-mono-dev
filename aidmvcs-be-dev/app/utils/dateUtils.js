// The dealership's time zone, set when the dealer account loads (app/dealer/context/UserContext.js). Betsy and the user,
// 2-3 Nov 2026 (Dante Brown's lead dates showed a time that hadn't come yet - the viewer's own time in Pakistan): every
// date on the platform reads in the dealership's time, whoever looks at it.
let defaultTimezone = null;
export const setDefaultTimezone = (timezone) => {
    defaultTimezone = timezone || null;
};

// Utility function to format timestamp
export const formatTimestamp = (timestamp, timezone = null) => {
    if (!timestamp) return "N/A";
    
    const options = {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    };
    
    // The given time zone, else the dealership's, else the platform's (New York) - never the viewer's own.
    options.timeZone = timezone || defaultTimezone || "America/New_York";
    
    return new Intl.DateTimeFormat("en-US", options).format(new Date(timestamp));
};
