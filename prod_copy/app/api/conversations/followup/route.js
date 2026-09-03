// app/api/followup/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb.js';
import Lead from '@models/Lead.js';
import Email from '@models/Email.js';
import FollowUpJob from '@models/FollowUpJob.js';
import { sendEmail } from '@lib/email.js';
import User from '@models/User.js';
// you’ll need to provide this yourself:
import { sendSMS } from '@lib/sms.js';
import {  onFollowUpCompleted } from '@lib/followupService.js';
import { checkLeadByIdentifiers } from '@lib/dealersocket-worknote.js';

export async function PUT(request) {
  try {
    try {
      await dbConnect();
      console.log('Database connection verified');
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return NextResponse.json(
        { error: 'Database connection error' },
        { status: 500 }
      );
    }
   
    if (!request.body) {
      return NextResponse.json(
        { error: 'Request body is empty' },
        { status: 400 }
      );
    }

    // 2. Safely parse the JSON
    let payload;
    try {
      const text = await request.text(); // Get raw text first
      
      // Check if body is empty
      if (!text.trim()) {
        return NextResponse.json(
          { error: 'Empty request body' },
          { status: 400 }
        );
      }
      
      payload = JSON.parse(text);
       console.log(payload);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON format' },
        { status: 400 }
      );
    }

    // 3. Validate payload structure
    if (typeof payload !== 'object' || payload === null) {
      return NextResponse.json(
        { error: 'Payload must be a JSON object' },
        { status: 400 }
      );
    }

    // 4. Destructure with defaults
    const {
      source,
      response: text,
      followup_id,
      subject = 'Follow-up'
    } = payload;
   
    // 1) Load the pending job
    const job = await FollowUpJob.findById(followup_id);
    //console.log(job,followup_id);
    if (!job) return NextResponse.json({ error: 'FollowUp job not found' }, { status: 404 });

    // 2) Load the lead
    
    const lead = await Lead.findById(job.leadId);
    //console.log('intial lead', lead);
    
    if (!lead) {
      await FollowUpJob.findByIdAndUpdate(followup_id, { 
        status: 'completed',
        executedAt: new Date()
      });
      return NextResponse.json({ error: 'Lead not found. Job marked as completed.' }, { status: 404 });
    }else{
      if(lead.fe_lead_status =='DND' || lead.fe_lead_status =='Managerial Review'|| lead.fe_lead_status =='Appointment Booked'){
        await FollowUpJob.findByIdAndUpdate(followup_id, { 
          status: 'completed',
          executedAt: new Date()
        });
        return NextResponse.json({ error: 'Lead status is DND or Managerial Review. Job marked as completed.' }, { status: 404 });
      }else{
        const dealer = await User.findOne({
          '_id': lead.dealer_id
        });
        console.log('dealer', dealer?.setting);
        const dealerstatus = dealer?.setting?.rules?.map(rule => rule.leadStatus) || [];
        console.log('dealerstatus',dealerstatus,lead.fe_lead_status);
        if(!dealerstatus.includes(lead.fe_lead_status)){
          await FollowUpJob.findByIdAndUpdate(followup_id, { 
            status: 'completed',
            executedAt: new Date()
          });
          return NextResponse.json({ error: `Lead status is ${lead.fe_lead_status}. No follow-up sent.` }, { status: 200 });
        }
      }

    }
    const dealer = await User.findOne({
          '_id': lead.dealer_id
    });
   
    //return NextResponse.json({ error: 'Lead not found. Job marked as completed.' }, { status: 404 });
    
    let sender =null;
    let recipient =null
    // 3) Find the most recent Email/SMS record for this lead & type
    const lastComm = await Email
      .findOne({ lead_id: lead._id , $or: [
        { is_note: { $exists: false } },
        { is_note: false }
      ]})
      .sort({ date: -1 });
    if(lastComm.status=='sent' || lastComm.status=='failed' || lastComm.status=='draft'){
       sender = lastComm.sender;
       recipient = lastComm.recipient
    }else{
       sender = lastComm.recipient;
       recipient = lastComm.sender;
    }
    const lead_phone =lead.phone;
   
    if(lastComm.communication_type =='sms' && lead_phone){
      recipient = formatPhoneForTwilio(lead_phone);
      sender = dealer?.dealer_account_information?.sms_conversion_phone ;
    }
    const parent_message_id = lastComm?.parent_message_id || lastComm?.message_id;
    const reply_message_id = lastComm?.message_id || null;
    // 4) Send the message
    let sentId =null, commStatus = 'pending';
    try {

      if(lead.response_mode=='sms'){

          sentId = await sendSMS(lead.phone, text,dealer);
          commStatus = sentId ? 'sent' : 'failed';
      }else if(lead.response_mode=='email' && sender){
          const subject = `Re: ${lastComm?.subject || 'Your inquiry'}`;
          sentId = await sendEmail(
            lead.email,
            subject,
            text,
            sender,        // original sender becomes our "from"
            reply_message_id ,
            dealer       // in-reply-to
          );
           commStatus = sentId ? 'sent' : 'failed';
        }
        else if (source.toLowerCase() === 'email' && sender) {
          // you can customize subject as you wish
          const subject = `Re: ${lastComm?.subject || 'Your inquiry'}`;
          sentId = await sendEmail(
            lead.email,
            subject,
            text,
            sender,        // original sender becomes our "from"
            reply_message_id ,
            dealer       // in-reply-to
          );
          commStatus = sentId ? 'sent' : 'failed';
        } else if (source.toLowerCase() === 'sms') {
          // assumes sendSMS returns a message ID or throws
          sentId = await sendSMS(lead.phone, text,dealer);
          commStatus = sentId ? 'sent' : 'failed';
        } else {
          await FollowUpJob.findByIdAndUpdate(followup_id, { 
            status: 'completed',
            executedAt: new Date()
          });
          return NextResponse.json({ error: 'Unknown source type' }, { status: 400 });
        }
      } catch (err) {
        // Handle Twilio-specific errors gracefully
        console.error('Error sending message:', err);
        if (err && (err.code === 21610 || err.status === 400)) {
          // 21610: Attempt to send to unsubscribed recipient
          // Mark lead as DND to prevent future sends
          try {
            /*await Lead.findByIdAndUpdate(lead._id, { fe_lead_status: 'DND' });*/
          } catch (updateErr) {
            console.error('Failed to set lead to DND after 21610:', updateErr);
          }
        } else if (err && err.code === 21408) {
          // 21408: Region not enabled for SMS from Twilio project
          // We simply mark this attempt failed; action required in Twilio console
          console.warn('Twilio geo permission error (21408) for number:', lead?.phone);
        }
        sentId = sentId || `sms-${Date.now()}`;
        commStatus = 'failed';
      }
      sentId =sentId || `sms-${Date.now()}`;
    
    
    // 5) Persist the communication record
    const record = new Email({
      message_id:        sentId,
      parent_message_id: parent_message_id,
      parent_conversation: lastComm?.parent_conversation ?? parent_message_id,
      sender:             sender,
      recipient:          recipient,
      subject:           subject,
      mail_content:      text,
      communication_type: source.toLowerCase(),
      status:            commStatus,
      dealer_id:         lead.dealer_id,
      lead_id:           lead._id,
      date:              new Date()
    });
    await record.save();
    // DealerSocket work note insert (best-effort)
    try {
      const updatedLead = lead; // already loaded
      const updatedDealer = await User.findById(lead.dealer_id);
      if (
        updatedLead &&
        updatedDealer?.dealer_account_information?.dealersocket_dealerid
      ) {
        const workNoteCriteria = {
          lead_id: updatedLead._id?.toString(),
          dealer_id: updatedDealer.dealer_account_information.dealersocket_dealerid,
          frenchise_id: updatedDealer.dealer_account_information.dealersocket_frenchiseid,
          entity_email: updatedLead.email,
          entity_phone: updatedLead.phone ,
          vin: updatedLead.vin || null,
          auto_insert_work_note: true,
          vendor_name: 'AutoPulse'
        };
        console.log('DealerSocket work note criteria (followup):', workNoteCriteria);
        const workNoteResult = await checkLeadByIdentifiers(workNoteCriteria);
        if (workNoteResult.success && workNoteResult.found) {
          console.log('DealerSocket work note inserted (followup):', workNoteResult.work_notes);
        } else {
          console.log('DealerSocket work note not inserted (followup)');
        }
      }
    } catch (dsErr) {
      console.warn('DealerSocket work note insert failed (followup):', dsErr?.message || dsErr);
    }
   await FollowUpJob.findByIdAndUpdate(
      followup_id,
      {
        $set: {
          open_ai_response: null,
          status: 'completed' // Also update status if needed
        }
      },
      { new: true } // Return the updated document if needed
    );
    // 6) If the lead_status actually changed, trigger a fresh schedule
   
      // 7) Otherwise just chain the next run
     
      // Only chain next follow-up if NOT DND and NOT Managerial Review
      if (lead.fe_lead_status !== 'DND' && lead.fe_lead_status !== 'Managerial Review'&& lead.fe_lead_status !== 'Appointment Booked') {
        await onFollowUpCompleted(job);
      }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error in followup route:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function formatPhoneForTwilio(phone) {
  // Remove all non-digit characters

  const cleaned = phone.replace(/\D/g, '');

  // If the number starts with a country code (e.g., 91 for India), keep it
  if (cleaned.length > 10 && cleaned.startsWith('1')) {
    return `+${cleaned}`; // US numbers with country code
  } else if (cleaned.length > 10 && !cleaned.startsWith('1')) {
    return `+${cleaned}`; // Other countries (e.g., India: +919876543210)
  } else if (cleaned.length === 10) {
    return `+1${cleaned}`; // Default to US (+1) if 10 digits
  } else {
    throw new Error('Invalid phone number format');
  }
}
