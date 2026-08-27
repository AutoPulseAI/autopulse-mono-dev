import dbConnect from "@lib/mongodb";
import User from "@models/User";
import moment from 'moment-timezone';
import { nanoid } from 'nanoid';
import { addHestiaDomain, addCloudflareDNS, getHestiaDNSRecords } from "@utils/hestiaCloudflare";
const format24hToAMPM = (time24) => {
    if (!time24) return "";
    const [hours, minutes] = time24.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12; // Convert 0 → 12 for 12 AM
    return `${hour12}:${minutes} ${ampm}`;
  };
const sanitizeDomain = (inputDomain, baseDomain = process.env.BASEDOMAIN) => {
    try {
        let sanitizedDomain = inputDomain.trim().toLowerCase().replace(/^https?:\/\//i, "");
        sanitizedDomain = sanitizedDomain.split("/")[0];
        sanitizedDomain = sanitizedDomain.replace(/\./g, "-");
        const finalSubdomain = `${sanitizedDomain}.${baseDomain}`;
        return finalSubdomain;
    } catch (error) {
        console.error("Error sanitizing domain:", error);
        throw new Error("Failed to sanitize domain");
    }
};

const formatPhoneNumber = (phone) => {
    if (!phone) return phone;
    
    let formattedPhone = phone.toString().trim();
    
    // Remove any non-digit characters except +
    formattedPhone = formattedPhone.replace(/[^\d+]/g, '');
    
    // Handle different phone number formats
    if (formattedPhone.startsWith('+1') && formattedPhone.length === 12) {
        // Already in correct format: +1XXXXXXXXXX
        return formattedPhone;
    } else if (formattedPhone.startsWith('1') && formattedPhone.length === 11) {
        // Format: 1XXXXXXXXXX -> convert to +1XXXXXXXXXX
        return '+1' + formattedPhone.substring(1);
    } else if (formattedPhone.length === 10) {
        // Format: XXXXXXXXXX -> convert to +1XXXXXXXXXX
        return '+1' + formattedPhone;
    } else if (formattedPhone.startsWith('0') && formattedPhone.length === 11) {
        // Format: 0XXXXXXXXXX -> convert to +1XXXXXXXXXX (remove leading 0)
        return '+1' + formattedPhone.substring(1);
    } else {
        // Return original if can't format
        return phone;
    }
};

export async function PUT(req) {
    try {
        await dbConnect();
        const { dealerId, dealer_account_information } = await req.json();

        if (!dealerId) {
            return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const dealer = await User.findById(dealerId);
        if (!dealer) {
            return new Response(JSON.stringify({ message: "Dealer not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Check if domain or SMS phone already exists for another user
        const domain = dealer_account_information.domain_name
            ? dealer_account_information.domain_name.trim().toLowerCase()
            : dealer_account_information.domain_name;
        if (domain) {
            // Persist the normalized value so stored domains stay consistently lowercase
            dealer_account_information.domain_name = domain;
        }
        const smsPhone = dealer_account_information.sms_conversion_phone;
        const sanitizedDomain = domain ? sanitizeDomain(domain) : null;

        if (domain) {
            const existingUserWithDomain = await User.findOne({
                _id: { $ne: dealerId },
                "dealer_account_information.domain_name": domain,
            });

            const existingUserWithSanitizedDomain = await User.findOne({
                _id: { $ne: dealerId },
                "dealer_account_information.sanitized_domain": sanitizedDomain,
            });

            if (existingUserWithDomain || existingUserWithSanitizedDomain) {
                return new Response(
                    JSON.stringify({
                        message: "Domain or sanitized domain already exists for another user.",
                    }),
                    {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }
        }

        if (smsPhone) {
            const existingUserWithSMS = await User.findOne({
                _id: { $ne: dealerId },
                "dealer_account_information.sms_conversion_phone": smsPhone,
            });

            if (existingUserWithSMS) {
                return new Response(
                    JSON.stringify({
                        message: "SMS conversion phone already exists for another user.",
                    }),
                    {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }
        }

        // Check if both domain and SMS phone are being changed from existing values
        const existingDomain = dealer.dealer_account_information?.domain_name?.toLowerCase();
        const existingSMS = dealer.dealer_account_information?.sms_conversion_phone;
        
       /* if ((existingDomain || existingSMS) && 
            (existingDomain !== domain || existingSMS !== smsPhone)) {
            return new Response(
                JSON.stringify({
                    message: "Changing domain or SMS phone requires confirmation.",
                    requiresConfirmation: true
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }*/

        // Update dealer information
       

        if (dealer_account_information.weekly_availability && dealer_account_information.time_zone) {
            const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
            const timeZone = dealer_account_information.time_zone;
            const utcWeeklyAvailability = {};
            
            days.forEach(day => {
                if (dealer_account_information.weekly_availability[day]) {
                    const daySchedule = dealer_account_information.weekly_availability[day];
                    
                    // Process local time (keep existing format)
                    if (daySchedule.start) {
                        daySchedule.start = (daySchedule.start);
                    }
                    if (daySchedule.end) {
                        daySchedule.end = (daySchedule.end);
                    }
                    
                    // Create UTC version if the day is active
                    if (daySchedule.active) {
                        utcWeeklyAvailability[day] = {
                            active: true,
                            start: convertToUTC(daySchedule.start, timeZone),
                            end: convertToUTC(daySchedule.end, timeZone)
                        };
                    } else {
                        utcWeeklyAvailability[day] = {
                            active: false,
                            start: '',
                            end: ''
                        };
                    }
                }
            });
            
            // Add UTC version to the data
            dealer_account_information.utc_weekly_availability = utcWeeklyAvailability;
        }

        // Format and validate phone number first (before domain setup)
        if (dealer_account_information.sms_conversion_phone) {
            const formattedPhone = formatPhoneNumber(dealer_account_information.sms_conversion_phone);
            
            // Validate the formatted phone number
            if (!/^\+1\d{10}$/.test(formattedPhone)) {
                return new Response(
                    JSON.stringify({ 
                        message: "Invalid phone number format. Please provide a valid 10-digit US phone number.",
                        error: "Phone validation failed"
                    }),
                    {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }
            
            dealer_account_information.sms_conversion_phone = formattedPhone;
        }

        // Generate short code for store_website if provided and doesn't exist
        if (dealer_account_information.store_website) {
            const existingShortCode = dealer.dealer_account_information?.store_website_short_code;
            
            // Only generate new short code if one doesn't exist
            if (!existingShortCode) {
                let shortCode;
                let isUnique = false;
                
                // Ensure uniqueness across all dealers
                while (!isUnique) {
                    shortCode = nanoid(8);
                    const existingDealer = await User.findOne({
                        _id: { $ne: dealerId },
                        "dealer_account_information.store_website_short_code": shortCode
                    });
                    if (!existingDealer) {
                        isUnique = true;
                    }
                }
                
                dealer_account_information.store_website_short_code = shortCode;
                dealer_account_information.store_website_short_url = `https://autopulse.ai/d/${shortCode}`;
            } else {
                // Keep existing short code and URL when website is updated
                dealer_account_information.store_website_short_code = existingShortCode;
                dealer_account_information.store_website_short_url = dealer.dealer_account_information?.store_website_short_url || `https://autopulse.ai/d/${existingShortCode}`;
            }
        }

        // Update dealer account information
        dealer.dealer_account_information = {
            ...dealer.dealer_account_information,
            ...dealer_account_information,
        };

        // Only proceed with domain setup if phone validation passed
        console.log(sanitizedDomain)
        if (sanitizedDomain && existingDomain != domain) {
            try {
                const hestiaResult = await addHestiaDomain(sanitizedDomain);
                
                if (hestiaResult.success) {
                    const dnsrecord = await getHestiaDNSRecords(sanitizedDomain);
                    const cloudflare = await addCloudflareDNS(sanitizedDomain, dnsrecord);
                    dealer.dealer_account_information.sanitized_domain = sanitizedDomain;
                    dealer.dealer_account_information.cloudflare = cloudflare;
                } else {
                    throw new Error(`HestiaCP domain setup failed: ${hestiaResult.message || 'Unknown error'}`);
                }
                
                await dealer.save();
                return new Response(
                    JSON.stringify({
                        message: "Dealer account info saved and domain configured.",
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            } catch (error) {
                console.error("Error in domain setup:", error);
                return new Response(
                    JSON.stringify({ message: "Domain setup failed", error: error.message }),
                    {
                        status: 500,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }
        } else {
            await dealer.save();
            return new Response(
                JSON.stringify({ message: "Dealer account info saved" }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }
    } catch (error) {
        console.error("Error updating dealer:", error);
        return new Response(
            JSON.stringify({ message: "Error updating dealer", error: error.message }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

function convertToUTC(timeStr, timeZone) {
    if (!timeStr) return '';
    
    // Parse the time in the given time zone
    const momentTime = moment.tz(timeStr, 'h:mm A', timeZone);
    
    // Convert to UTC and format as 24-hour string
    return momentTime.utc().format('h:mm A');
}

// Add a new endpoint for checking domain and SMS
export async function POST(req) {
    try {
        await dbConnect();
        const { dealerId, domain_name, sms_conversion_phone } = await req.json();

        if (!dealerId) {
            return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const dealer = await User.findById(dealerId);
        if (!dealer) {
            return new Response(JSON.stringify({ message: "Dealer not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        let hasExisting = false;
        
        // Check if domain exists for another user
        if (domain_name) {
            const normalizedDomainName = domain_name.trim().toLowerCase();
            const sanitizedDomain = sanitizeDomain(normalizedDomainName);
            const existingUserWithDomain = await User.findOne({
                _id: { $ne: dealerId },
                "dealer_account_information.domain_name": normalizedDomainName,
            });

            const existingUserWithSanitizedDomain = await User.findOne({
                _id: { $ne: dealerId },
                "dealer_account_information.sanitized_domain": sanitizedDomain,
            });

            if (existingUserWithDomain || existingUserWithSanitizedDomain) {
                hasExisting = true;
            }
        }

        // Check if SMS phone exists for another user
        if (sms_conversion_phone) {
            const existingUserWithSMS = await User.findOne({
                _id: { $ne: dealerId },
                "dealer_account_information.sms_conversion_phone": sms_conversion_phone,
            });

            if (existingUserWithSMS) {
                hasExisting = true;
            }
        }

        return new Response(
            JSON.stringify({ hasExisting }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("Error checking domain and SMS:", error);
        return new Response(
            JSON.stringify({ message: "Error checking domain and SMS", error: error.message }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

// ... rest of your existing exports (GET, DELETE) remain the same ...