import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import CampaignTemplate from "@models/CampaignTemplate";
import { verifyToken } from "@lib/auth";

// GET: Fetch a single template
export async function GET(req, { params }) {
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

    const { id } = await params;
    const template = await CampaignTemplate.findById(id).populate("created_by", "name email");

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ data: template }, { status: 200 });
  } catch (error) {
    console.error("Error fetching template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch template" },
      { status: 500 }
    );
  }
}

// PUT: Update a template
export async function PUT(req, { params }) {
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

    const { id } = await params;
    const data = await req.json();
    const { name, description, subject, body, category, is_default } = data;

    const template = await CampaignTemplate.findById(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // If setting as default, unset other defaults for this dealer and message_type
    if (is_default && !template.is_default) {
      await CampaignTemplate.updateMany(
        { dealer_id: template.dealer_id, message_type: template.message_type, is_default: true },
        { $set: { is_default: false } }
      );
    }

    if (name !== undefined) template.name = name;
    if (description !== undefined) template.description = description;
    if (subject !== undefined) template.subject = subject;
    if (body !== undefined) template.body = body;
    if (category !== undefined) template.category = category;
    if (is_default !== undefined) template.is_default = is_default;

    await template.save();

    return NextResponse.json(
      { data: template, message: "Template updated successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update template" },
      { status: 500 }
    );
  }
}

// DELETE: Delete a template
export async function DELETE(req, { params }) {
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

    const { id } = await params;
    const template = await CampaignTemplate.findByIdAndDelete(id);

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json(
      { message: "Template deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting template:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete template" },
      { status: 500 }
    );
  }
}

