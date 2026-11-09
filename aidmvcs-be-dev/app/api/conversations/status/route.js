// app/api/leads/status/route.js
import { NextResponse } from "next/server";
import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import Email from "@models/Email";
import FollowUpJob from '@models/FollowUpJob.js'; // Using same Email model for SMS too
import { onLeadStatusChange ,onFollowUpEvent} from '@lib/followupService.js';
import { requireUser, requireDealerAccess } from '@lib/apiGuard';

export async function PUT(request) {
  // Security fix (Nov 2026): changed any lead's status by message id with no sign-in. Now the lead's own dealer,
  // its agency or a super admin (no caller in the app today; the CRM uses /api/conversations/lead/status).
  const signedIn = await requireUser(request);
  if (signedIn.response) return signedIn.response;
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
           
            if (!existingLead) {
              return NextResponse.json({ error: "Lead not found" }, { status: 404 });
            }
            const guard = await requireDealerAccess(request, String(existingLead.dealer_id));
            if (guard.response) return guard.response;
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
