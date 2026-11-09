import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import User from "@models/User";
import { requireDealerAccess } from "@lib/apiGuard";
const sanitizeDomain = (inputDomain, baseDomain = "jugaadtravel.com") => {
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

export async function POST(req) {
    try {
        await dbConnect();
        const { dealerId, domain_name, sms_conversion_phone } = await req.json();

        // Security fix (Nov 2026): only that dealer, its agency or a super admin (it was open to anyone).
        if (dealerId) {
            const guard = await requireDealerAccess(req, String(dealerId));
            if (guard.response) return guard.response;
        }

        if (!dealerId) {
            return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const existingFields = {};
        let hasExisting = false;

        // Check domain uniqueness
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

            if (existingUserWithDomain) {
                existingFields.domain_name = "This domain is already in use by another account";
                hasExisting = true;
            } else if (existingUserWithSanitizedDomain) {
                existingFields.domain_name = "A similar domain is already in use by another account";
                hasExisting = true;
            }
        }

        // Check SMS phone uniqueness
        if (sms_conversion_phone) {
            const existingUserWithSMS = await User.findOne({
                _id: { $ne: dealerId },
                "dealer_account_information.sms_conversion_phone": sms_conversion_phone,
            });

            if (existingUserWithSMS) {
                existingFields.sms_conversion_phone = "This SMS phone is already in use by another account";
                hasExisting = true;
            }
        }

        return new Response(
            JSON.stringify({ hasExisting, existingFields }),
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