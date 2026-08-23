import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Email from "@models/Email";
import { simpleParser } from "mailparser";

export async function GET(req) {
    try {
        // Connect to MongoDB
        await dbConnect();
        
        const { searchParams } = new URL(req.url);
        const dealer_id = searchParams.get("dealer_id");
        const parent_conversation = searchParams.get("parent_conversation") || null;
        const sender = searchParams.get("sender");
        const communication_type = searchParams.get("communication_type");
        const recipient = searchParams.get("recipient");
        const text = searchParams.get("text");
        const page = parseInt(searchParams.get("page")) || 1;
        const limit = parseInt(searchParams.get("limit")) || 50;
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");

        let filter = {};

        // Parent email check
        if (parent_conversation !== undefined && parent_conversation !== null) {
            if (parent_conversation === '') {
                filter.$or = [
                    { 
                        $or: [
                            { parent_conversation: null },
                            { parent_conversation: '' }
                        ]
                    },
                    { $or: [
                        { parent_message_id: null },
                        { parent_message_id: '' }
                    ] }
                ];
            } else {
                filter.parent_message_id = parent_conversation;
            }
        } else {
            filter.$or = [
                { 
                    $or: [
                        { parent_conversation: null },
                        { parent_conversation: '' }
                    ]
                },
                { $or: [
                    { parent_message_id: null },
                    { parent_message_id: '' }
                ] }
            ];
        }

        if (dealer_id) filter.dealer_id = dealer_id;
        if (sender) filter.sender = { $regex: sender, $options: "i" };
        if (recipient) filter.recipient = { $regex: recipient, $options: "i" };
        if (communication_type) filter.communication_type = communication_type;
        if (text) {
            filter.$or = [
                { subject: { $regex: text, $options: "i" } },
                { mail_content: { $regex: text, $options: "i" } },
            ];
        }

        if (startDate || endDate) {
            filter.date = {};
            if (startDate) {
                filter.date.$gte = new Date(startDate);
            }
            if (endDate) {
                const endDateObj = new Date(endDate);
                endDateObj.setDate(endDateObj.getDate() + 1);
                filter.date.$lte = endDateObj;
            }
        }


        // Get raw emails from DB
        const rawEmails = await Email.find(filter)
            .sort({ date: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        // Parse each email content
        const emails = await Promise.all(
            rawEmails.map(async (email) => {
                try {
                    const content = email.mail_content || "";
                    const parsed = await simpleParser(content);
                    return {
                        ...email._doc,
                        parsedContent: {
                            text: parsed.text,
                            html: parsed.html,
                            subject: parsed.subject,
                            from: parsed.from,
                            to: parsed.to,
                            date: parsed.date,
                            attachments: parsed.attachments
                        }
                    };
                } catch (parseError) {
                    console.error("Failed to parse email:", parseError);
                    return {
                        ...email._doc,
                        parsedContent: {
                            text: email.mail_content,
                            html: null,
                            error: "Failed to parse email"
                        }
                    };
                }
            })
        );

        const totalRecords = await Email.countDocuments(filter);

        return NextResponse.json({
            emails,
            page,
            totalPages: Math.ceil(totalRecords / limit),
            totalRecords,
        }, { status: 200 });

    } catch (error) {
        console.error('Error in conversations API:', error);
        
        // Handle specific connection errors
        if (error.message.includes('Cannot call') || error.message.includes('before initial connection')) {
            return NextResponse.json({ 
                error: 'Database connection not ready. Please try again.',
                details: 'CONNECTION_ERROR'
            }, { status: 503 });
        }
        
        return NextResponse.json({ 
            error: error.message,
            details: 'INTERNAL_ERROR'
        }, { status: 500 });
    }
}