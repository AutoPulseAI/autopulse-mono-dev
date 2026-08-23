import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import CampaignTemplate from "@models/CampaignTemplate";
import { verifyToken } from "@lib/auth";
import { welcomeTemplateHTML, welcomeTemplateData } from "@lib/templates/campaign-templates/welcomeTemplate";
import { promotionTemplateHTML, promotionTemplateData } from "@lib/templates/campaign-templates/promotionTemplate";
import { newsletterTemplateHTML, newsletterTemplateData } from "@lib/templates/campaign-templates/newsletterTemplate";
import { announcementTemplateHTML, announcementTemplateData } from "@lib/templates/campaign-templates/announcementTemplate";

// POST: Seed default templates for a dealer
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

    const { dealer_id } = await req.json();

    if (!dealer_id) {
      return NextResponse.json(
        { error: "dealer_id is required" },
        { status: 400 }
      );
    }

    // Check if default templates already exist
    const existingTemplates = await CampaignTemplate.find({
      dealer_id,
      is_default: true,
      message_type: "email"
    });

    if (existingTemplates.length > 0) {
      return NextResponse.json(
        { 
          message: "Default templates already exist for this dealer",
          templates: existingTemplates 
        },
        { status: 200 }
      );
    }

    const userId = decoded.userId || decoded.id || null;

    // Template 1: Welcome Email Template
    const welcomeTemplate = {
      ...welcomeTemplateData,
      message_type: "email",
      dealer_id,
      body: welcomeTemplateHTML,
      is_default: true,
      created_by: userId
    };

    // Template 2: Product Promotion Template
    const promotionTemplate = {
      ...promotionTemplateData,
      message_type: "email",
      dealer_id,
      body: promotionTemplateHTML,
      is_default: true,
      created_by: userId
    };

    // Template 3: Newsletter Template
    const newsletterTemplate = {
      ...newsletterTemplateData,
      message_type: "email",
      dealer_id,
      body: newsletterTemplateHTML,
      is_default: true,
      created_by: userId
    };

    // Template 4: Service Announcement Template
    const announcementTemplate = {
      ...announcementTemplateData,
      message_type: "email",
      dealer_id,
      body: announcementTemplateHTML,
      is_default: true,
      created_by: userId
    };

    // Insert all templates
    const templates = await CampaignTemplate.insertMany([
      welcomeTemplate,
      promotionTemplate,
      newsletterTemplate,
      announcementTemplate
    ]);

    return NextResponse.json(
      { 
        message: "Default templates created successfully",
        templates,
        count: templates.length
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error seeding default templates:", error);
    return NextResponse.json(
      { error: error.message || "Failed to seed default templates" },
      { status: 500 }
    );
  }
}

