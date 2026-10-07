import { NextResponse } from 'next/server';
import Email from '@models/Email';
import User from '@models/User';
import Lead from '@models/Lead';
import { checkLeadByIdentifiers } from '@lib/dealersocket-worknote.js';
import FollowUpJob from '@models/FollowUpJob';
import dbConnect from '@lib/mongodb';
import { sendEmail } from '@lib/email'; 
import { sendSMS } from '@lib/sms';
import {  onFollowUpEvent} from '@lib/followupService.js';
import { notifyAiOfStaffReply } from '@lib/ai/aiStaff';
import jwt from 'jsonwebtoken';

function normalizeUserLanguage(raw) {
  const v = raw == null ? '' : String(raw).trim();
  return v ? v.toLowerCase() : 'english';
}

function toDisplayLanguageName(rawLower) {
  const s = normalizeUserLanguage(rawLower);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function translateOutgoing({ translateUrl, targetLanguage, sourceHint, subject, content, authHeader }) {
  const messages = [{ id: 'body', text: content }];
  if (subject) messages.push({ id: 'subject', text: subject });

  const headers = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(translateUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetLanguage, sourceHint, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to translate outgoing message.');
  }
  return {
    subject: data?.translations?.subject || subject,
    content: data?.translations?.body || content,
  };
}

export async function POST(request) {
  try {
    await dbConnect();
    const translateUrl = new URL('/api/conversations/translate', request.url).toString();

    // Extract token from Authorization header
    let currentUser = null;
    let messageBy = null; // Default to null (system message)
    let authHeaderForDownstream = null;
    
    try {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        authHeaderForDownstream = authHeader;
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUser = await User.findById(decoded.userId).select('_id name email type');
        // Set message_by to user ID for authenticated users
        if (currentUser) {
          messageBy = currentUser._id;
        }else{
          return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
        }
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    } catch (err) {
      console.warn("Token verification failed in reply route:", err.message);
      // Continue without token - messageBy will remain null
    }

    const {
        parent_message_id,
      content,
      subject,
      communicationType,
      originalMessage
    } = await request.json();

    // Validate required fields
    if (!parent_message_id || !content || !communicationType) {
      return NextResponse.json(
        { message: 'Missing required fields' },
        { status: 400 }
      );
    }



    // Find the parent message and latest reply in the thread
    const parentMessage = await Email.findOne({ 
      message_id: parent_message_id,
      $or: [
        { is_note: { $exists: false } },
        { is_note: false }
      ]
    });
    if (!parentMessage) {
      return NextResponse.json(
        { message: 'Parent message not found' },
        { status: 404 }
      );
    }
  
     const dealer = await User.findOne({
            '_id': parentMessage.dealer_id
        });

    const latestReply = await Email.findOne({ 
      parent_message_id: parent_message_id,
      $or: [
        { is_note: { $exists: false } },
        { is_note: false }
      ]
    })
      .sort({ timestamp: -1 })
      .limit(1);

    // Determine which message to use as reference (parent or latest reply)
    const referenceMessage = latestReply || parentMessage;
    const latestMessageId = referenceMessage.message_id;

    // Determine sender and recipient based on message direction
    let from, to;
    console.log(referenceMessage);
    if (referenceMessage.status === 'incoming' || referenceMessage.status === 'received') {
      to = referenceMessage.sender;
      from = referenceMessage.recipient;
    } else {
      from = referenceMessage.sender;
      to = referenceMessage.recipient;
    }

    let sentMessageId = null;
    let status = 'sent';

    // Resolve lead user language (fallback English) and translate before sending/saving.
    const leadDoc = parentMessage.lead_id ? await Lead.findById(parentMessage.lead_id).select('user_language') : null;
    let leadUserLanguageRaw = latestReply?.user_language?latestReply.user_language:normalizeUserLanguage(leadDoc?.user_language);
    const leadUserLanguageDisplay = toDisplayLanguageName(leadUserLanguageRaw);
    const sourceHint = leadUserLanguageDisplay; // we don't know the agent language here; use lead language as hint

    let contentToSend = content;
    let subjectToSend = subject;
    try {
      if (communicationType === 'email') {
        const translated = await translateOutgoing({
          translateUrl,
          targetLanguage: leadUserLanguageDisplay,
          sourceHint,
          subject: subjectToSend,
          content: contentToSend,
          authHeader: authHeaderForDownstream,
        });
        subjectToSend = translated.subject;
        contentToSend = translated.content;
      } else if (communicationType === 'sms') {
        const translated = await translateOutgoing({
          translateUrl,
          targetLanguage: leadUserLanguageDisplay,
          sourceHint,
          subject: null,
          content: contentToSend,
          authHeader: authHeaderForDownstream,
        });
        contentToSend = translated.content;
      }
    } catch (trErr) {
      console.warn('Outgoing translation failed, sending original content:', trErr?.message || trErr);
    }

    try {
      if (communicationType === 'email') {
        sentMessageId = await sendEmail(
          to,
          subjectToSend,
          contentToSend,
          from,
          latestMessageId,
          dealer
        );
        console.log('Email sent successfully. Message ID:', sentMessageId);
      } else if (communicationType === 'sms') {
        sentMessageId = await sendSMS(
          to,
          
          contentToSend,
          dealer
        );
        console.log('SMS sent successfully. Message ID:', sentMessageId);
      }
    } catch (error) {
      status = 'failed';
      console.error(`Error sending ${communicationType}:`, error);
    }

    // Create the conversation record
    const conversationRecord = new Email({
      message_id: sentMessageId || `local-${Date.now()}`,
      parent_message_id: parent_message_id,
      parent_conversation: latestMessageId,
      sender: from,
      recipient: to,
      subject: communicationType === 'email' ? subjectToSend : undefined,
      mail_content:  contentToSend,
    
      communication_type: communicationType,
      message_by: messageBy, // Set based on token verification (defaults to 'user')
      status,
      dealer_id: parentMessage.dealer_id,
      lead_id: parentMessage.lead_id,
      user_language: leadUserLanguageRaw,
      date:new Date(),
      timestamp: new Date(),
    });
    if(parentMessage.lead_id){ 
      const leadId = parentMessage.lead_id;
      const job = await FollowUpJob.findOne({ leadId });
          if (job) {
           
            await onFollowUpEvent(job);
          }
    }

    await conversationRecord.save();

    // A person has answered this customer, so the AI stops replying to the
    // lead and cancels its pending channel switch until staff hand it back
    // (MASTER_PLAN_1 Stage 11). No-op for dealers in AI `off` mode; never throws.
    if (parentMessage.lead_id) {
      await notifyAiOfStaffReply({
        leadId: parentMessage.lead_id,
        dealerId: parentMessage.dealer_id,
        emailRecordId: conversationRecord._id,
        staffName: currentUser?.name,
      });
    }

    // Update parent message status
   
    // DealerSocket work note insert (best-effort)
    try {
      const leadId = parentMessage.lead_id;
      const updatedLead = leadId ? await Lead.findById(leadId) : null;
      const updatedDealer = await User.findById(parentMessage.dealer_id);
      if (
        updatedLead &&
        updatedDealer?.dealer_account_information?.dealersocket_dealerid
      ) {
        const workNoteCriteria = {
          lead_id: leadId?.toString(),
          dealer_id: updatedDealer.dealer_account_information.dealersocket_dealerid,
          frenchise_id: updatedDealer.dealer_account_information.dealersocket_frenchiseid,
          entity_email: updatedLead.email || from,
          entity_phone: updatedLead.phone || to,
          vin: updatedLead.vin || null,
          auto_insert_work_note: true,
          vendor_name: 'AutoPulse'
        };
        console.log('DealerSocket work note criteria (reply):', workNoteCriteria);
        const workNoteResult = await checkLeadByIdentifiers(workNoteCriteria);
        if (workNoteResult.success && workNoteResult.found) {
          console.log('DealerSocket work note inserted (reply):', workNoteResult.work_notes);
        } else {
          console.log('DealerSocket work note not inserted (reply)');
        }
      }
    } catch (dsErr) {
      console.warn('DealerSocket work note insert failed (reply):', dsErr?.message || dsErr);
    }

    return NextResponse.json(
      { 
        success: status === 'sent',
        message: `${communicationType} ${status === 'sent' ? 'sent' : 'failed to send'}`,
        data: conversationRecord 
      },
      { status: status === 'sent' ? 201 : 500 }
    );

  } catch (error) {
    console.error('Error in conversation reply:', error);
    return NextResponse.json(
      { 
        success: false,
        message: 'Failed to process reply',
        error: error.message 
      },
      { status: 500 }
    );
  }
}