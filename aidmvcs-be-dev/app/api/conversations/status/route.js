// app/api/leads/status/route.js
import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import Email from "@models/Email";
import FollowUpJob from '@models/FollowUpJob.js'; // Using same Email model for SMS too
import { onLeadStatusChange ,onFollowUpEvent} from '@lib/followupService.js';

export async function PUT(request) {
  try {
    await dbConnect();
    const { parent_id, lead_id,lead_status } = await request.json();

    if (!parent_id || !lead_status) {
      return NextResponse.json(
        { error: "Missing `id` or `status` in request body" },
        { status: 400 }
      );
    }

   

    

    if (parent_id) {
           
        // Find the lead associated with this conversation
        const existingparent = await Email.findOne({ 
            $or: [
                
                { 'message_id': parent_id }
            ] 
        });
        console.log(existingparent);
        if (existingparent) {
            const existingLead = await Lead.findOne({ 
                $or: [
                    
                    { _id: existingparent.lead_id }
                ] 
            });
           
            const updates = {};
            if (lead_status) {
                updates.lead_status = lead_status;
                updates.status = lead_status;
            }
            
            
            
            if (Object.keys(updates).length > 0) {
                await Lead.findByIdAndUpdate(existingLead._id, updates);
                console.log('Lead updated successfully:', updates);
            }
            return NextResponse.json({ lead: existingLead }, { status: 200 });
        }
           
    }

   
  } catch (err) {
    console.error("PUT /api/leads/status error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
