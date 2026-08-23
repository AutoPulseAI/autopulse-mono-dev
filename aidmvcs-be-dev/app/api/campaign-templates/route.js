import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import CampaignTemplate from "@models/CampaignTemplate";
import { verifyToken } from "@lib/auth";

// GET: Fetch all templates for a dealer
export async function GET(req) {
  try {
    await dbConnect();
    
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dealerId = searchParams.get("dealer_id");
    const messageType = searchParams.get("message_type"); // 'email' or 'sms'
    const category = searchParams.get("category");

    if (!dealerId) {
      return NextResponse.json({ error: "dealer_id is required" }, { status: 400 });
    }

    const query = { dealer_id: dealerId };
    if (messageType) {
      query.message_type = messageType;
    }
    if (category) {
      query.category = category;
    }

    const templates = await CampaignTemplate.find(query)
      .sort({ createdAt: -1 })
      .populate("created_by", "name email");

    return NextResponse.json(
      { data: templates, count: templates.length },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching templates:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

// POST: Create a new template
export async function POST(req) {
  try {
    await dbConnect();
    
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const data = await req.json();
    const { name, description, message_type, dealer_id, subject, body, category, is_default } = data;

    if (!name || !message_type || !dealer_id) {
      return NextResponse.json(
        { error: "name, message_type, and dealer_id are required" },
        { status: 400 }
      );
    }

    // If setting as default, unset other defaults for this dealer and message_type
    if (is_default) {
      await CampaignTemplate.updateMany(
        { dealer_id, message_type, is_default: true },
        { $set: { is_default: false } }
      );
    }

    const template = await CampaignTemplate.create({
      name,
      description: description || "",
      message_type,
      dealer_id,
      subject: subject || "",
      body: body || "",
      category: category || "General",
      is_default: is_default || false,
      created_by: decoded.userId || decoded.id
    });

    return NextResponse.json(
      { data: template, message: "Template created successfully" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create template" },
      { status: 500 }
    );
  }
}

