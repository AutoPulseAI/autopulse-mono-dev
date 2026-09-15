import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import { Types } from "mongoose";
const { ObjectId } = Types;

export async function GET(req) {
    try {
        // Connect to MongoDB
        await dbConnect();
        const { searchParams } = new URL(req.url);
        const dealer_id = searchParams.get("dealer_id");
        const lead_id = searchParams.get("lead_id");
        const sender = searchParams.get("sender");
        const recipient = searchParams.get("recipient");
        const text = searchParams.get("text");
        const page = parseInt(searchParams.get("page")) || 1;
        const limit = parseInt(searchParams.get("limit")) || 50;
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");

        // Validate dealer_id is provided
        /*if (!dealer_id) {
            return NextResponse.json(
                { error: "dealer_id is required" },
                { status: 400 }
            );
        }*/

        let filter = { dealer_id };

        // Add date range filtering if provided
       

        // Add other filters if provided
        if (sender) filter.sender = { $regex: sender, $options: "i" };
        if (recipient) filter.recipient = { $regex: recipient, $options: "i" };
        if (text) {
            filter.$or = [
                { subject: { $regex: text, $options: "i" } },
                { mail_content: { $regex: text, $options: "i" } }
            ];
        }

        // If lead_id is provided, return the entire conversation thread for
        // that lead. Every message (inbound and outbound) is written with
        // lead_id set directly, so filtering on it - rather than walking a
        // parent_message_id/parent_conversation chain that doesn't always
        // point back to a single root - can't drop messages. The caller
        // doesn't paginate this view, so return the full thread instead of
        // truncating at `limit` (a 50-message default was silently hiding
        // everything past message #50 in longer conversations).
        if (lead_id) {
            // Validate lead_id is a valid ObjectId
            if (!ObjectId.isValid(lead_id)) {
                return NextResponse.json(
                    { error: "Invalid lead_id format" },
                    { status: 400 }
                );
            }

            const conversationFilter = { lead_id: new ObjectId(lead_id) };

            // Apply date filtering to conversation thread if provided
            if (startDate || endDate) {
                conversationFilter.date = {};
                if (startDate) {
                    conversationFilter.date.$gte = new Date(startDate);
                }
                if (endDate) {
                    const endDateObj = new Date(endDate);
                    endDateObj.setDate(endDateObj.getDate() + 1);
                    conversationFilter.date.$lte = endDateObj;
                }
            }

            const conversationThread = await Email.find(conversationFilter)
                .populate({
                    path: 'message_by',
                    select: 'name email',
                    strictPopulate: false
                })
                .sort({ timestamp: 1 });

            return NextResponse.json({
                emails: conversationThread,
                page: 1,
                totalPages: 1,
                totalRecords: conversationThread.length,
            }, { status: 200 });
        }

        // Regular filtering when no lead_id is provided
        const emails = await Email.find(filter)
            .populate({
                path: 'message_by',
                select: 'name email',
                strictPopulate: false
            })
            .sort({ timestamp: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const totalRecords = await Email.countDocuments(filter);

        return NextResponse.json({
            emails,
            page,
            totalPages: Math.ceil(totalRecords / limit),
            totalRecords,
        }, { status: 200 });

    } catch (error) {
        //console.error("Error in GET /api/emails:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}