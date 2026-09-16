import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import { Types } from "mongoose";
const { ObjectId } = Types;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function encodeCursor(message) {
    if (!message) return null;
    return Buffer.from(JSON.stringify({
        timestamp: new Date(message.timestamp).toISOString(),
        id: message._id.toString(),
    })).toString("base64url");
}

function decodeCursor(value) {
    try {
        const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        const timestamp = new Date(decoded.timestamp);
        if (!decoded.id || Number.isNaN(timestamp.getTime()) || !ObjectId.isValid(decoded.id)) {
            return null;
        }
        return { timestamp, id: new ObjectId(decoded.id) };
    } catch {
        return null;
    }
}

function cursorFilter(cursor, direction) {
    const comparison = direction === "after" ? "$gt" : "$lt";
    return {
        $or: [
            { timestamp: { [comparison]: cursor.timestamp } },
            { timestamp: cursor.timestamp, _id: { [comparison]: cursor.id } },
        ],
    };
}

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
        const rawLimit = searchParams.get("limit");
        const parsedLimit = rawLimit == null ? DEFAULT_LIMIT : Number(rawLimit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
            return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
        }
        const limit = Math.min(parsedLimit, MAX_LIMIT);
        const page = parseInt(searchParams.get("page")) || 1;
        const beforeValue = searchParams.get("before");
        const afterValue = searchParams.get("after");
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");

        if (beforeValue && afterValue) {
            return NextResponse.json(
                { error: "before and after cursors are mutually exclusive" },
                { status: 400 }
            );
        }

        const cursorValue = beforeValue || afterValue;
        const cursor = cursorValue ? decodeCursor(cursorValue) : null;
        if (cursorValue && !cursor) {
            return NextResponse.json({ error: "Invalid conversation cursor" }, { status: 400 });
        }

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

        // If lead_id is provided, page through the lead's complete conversation
        // with a stable timestamp/_id cursor.
        if (lead_id) {
            // Validate lead_id is a valid ObjectId
            if (!ObjectId.isValid(lead_id)) {
                return NextResponse.json(
                    { error: "Invalid lead_id format" },
                    { status: 400 }
                );
            }

            const filters = [{ lead_id: new ObjectId(lead_id) }];

            // Apply date filtering to conversation thread if provided
            if (startDate || endDate) {
                const dateFilter = {};
                if (startDate) {
                    dateFilter.$gte = new Date(startDate);
                }
                if (endDate) {
                    const endDateObj = new Date(endDate);
                    endDateObj.setDate(endDateObj.getDate() + 1);
                    dateFilter.$lte = endDateObj;
                }
                filters.push({ date: dateFilter });
            }

            if (cursor) {
                filters.push(cursorFilter(cursor, afterValue ? "after" : "before"));
            }

            const isAfterRequest = Boolean(afterValue);
            const sortDirection = isAfterRequest ? 1 : -1;
            const queryFilter = filters.length === 1 ? filters[0] : { $and: filters };
            const records = await Email.find(queryFilter)
                .populate({
                    path: 'message_by',
                    select: 'name email',
                    strictPopulate: false
                })
                .sort({ timestamp: sortDirection, _id: sortDirection })
                .limit(limit + 1);

            const hasExtraRecord = records.length > limit;
            const pageRecords = records.slice(0, limit);
            const conversationThread = isAfterRequest ? pageRecords : pageRecords.reverse();

            return NextResponse.json({
                emails: conversationThread,
                pageInfo: {
                    olderCursor: encodeCursor(conversationThread[0]),
                    newerCursor: encodeCursor(conversationThread[conversationThread.length - 1]),
                    hasOlder: !isAfterRequest && hasExtraRecord,
                    hasNewer: isAfterRequest && hasExtraRecord,
                },
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
        console.error("Error in GET /api/conversations/lead:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
