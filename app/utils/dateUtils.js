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
    
    // If timezone is provided, add it to options
    if (timezone) {
        options.timeZone = timezone;
    }
    
    return new Intl.DateTimeFormat("en-US", options).format(new Date(timestamp));
};
