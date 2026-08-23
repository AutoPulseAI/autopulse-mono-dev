import axios from 'axios'; // For making HTTP requests
import dbConnect from '../lib/mongodb.js'; // For database operations
import Lead from '../models/Lead.js'; // Lead model
import Email from '../models/Email.js'; // Email model
import { sendEmail } from '../lib/email.js'; // For sending emails
import JSON5 from 'json5';

// Connect to the database
await dbConnect();

// Function to process an email
export async function processEmail(job) {
  console.log(job.data);
  const { conversationThread, currentEmail } = job.data;

  try {
    // Extract details from the current email
    let { emailBody, emailId, recipient, sender, subject, dealer_id } = currentEmail;
   

    // Create a prompt for the OpenAI API
    const prompt = await createPrompt( currentEmail,conversationThread);

    // Send the email body to the third-party API
    const response = await openaitrigger(prompt);
    //const response = await callOllama(job.data);

    console.log('Third-party API response:', response);
    let leadId = null;

    // Extract the response data
    const { create_lead, lead, new_mail, Response, message_id, parent_message_id } = response;

    if (create_lead && lead) {
      const newLead = new Lead({
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        source: lead.source || 'email',
        dealer_id: dealer_id,
      });

      const savedLead = await newLead.save();
      leadId = savedLead._id;
      console.log('Lead created successfully:', newLead);
    }

    let emailStatus = 'pending';
    let sentMessageId = null; // To store the message_id of the sent email
    let recipientEmail;
    const emailSubject = `Re: ${subject}`;
    const emailText = Response ? Response : 'Thank you for your email. We will get back to you shortly.'; // Default response

    // Determine the base parent ID for the conversation
    let baseParentId = currentEmail.parent_conversation || currentEmail.message_id;

    if (!new_mail) {
      // If new_mail is false, send the email as a reply to the current email
      recipientEmail = sender;
      emailId = currentEmail.message_id; // Use the current email's message_id as the parent
    } else {
      // If new_mail is true, send a new email (start a new conversation)
      recipientEmail = lead?.email || sender;
      emailId = null; // No parent for a new email
      baseParentId = null; // No base parent ID for a new conversation
    }

    try {
      // Send the email and capture the message_id
      sentMessageId = await sendEmail(recipientEmail, emailSubject, emailText, recipient, emailId);
      emailStatus = 'sent';
      console.log('Email sent successfully. Message ID:', sentMessageId);
    } catch (error) {
      emailStatus = 'failed';
      console.error('Error sending email:', error);
    }

    // Save the email status and response
    const emailRecord = new Email({
      message_id: sentMessageId, // Use sentMessageId if available
      parent_message_id: emailId, // Use current email's message_id as parent (null for new mail)
      parent_conversation: baseParentId, // Use base parent ID for the conversation (null for new mail)
      sender: recipient,
      recipient: recipientEmail, // Save the correct recipient
      subject: emailSubject,
      mail_content: emailText,
      status: emailStatus,
      dealer_id: dealer_id,
      lead_id: leadId,
      api_response: response, // Save the entire API response for reference
    });

    await emailRecord.save();
  } catch (error) {
    console.error('Error processing email:', error);
  }
}

// Function to create a prompt for OpenAI
async function createPrompt(currentEmail, conversationThread) {
    const { subject, sender, recipient, mail_content } = currentEmail;
  
    const prompt = `
  Analyze the following email and conversation thread, and generate a response in the specified format.
  
  **Email Details:**
  - Subject: ${subject}
  - Sender: ${sender}
  - Recipient: ${recipient}
  - Content: ${mail_content}
  
  **Conversation Thread:**
  ${JSON.stringify(conversationThread, null, 2)}
  
  **Instructions:**
  1. Analyze the **current email** to determine if a lead should be created. If yes, set \`create_lead\` to \`true\` and provide lead details (\`name\`, \`email\`, \`phone\`, \`source\`). If no, set \`create_lead\` to \`false\` and leave \`lead\` blank.
  2. If \`create_lead\` is \`true\`, set \`new_mail\` to \`true\` and provide the response message for a **new email**.
  3. If \`create_lead\` is \`false\`, set \`new_mail\` to \`false\` and provide the response message for a **reply** to the current email.
  4. Include the \`message_id\` and \`parent_message_id\` for tracking.
  
  **Response Format:**
  {
    create_lead: true or false,
    lead: {
      name: '...',
      email: '...',
      phone: '...',
      source: '...'
    },
    new_mail: true or false,
    Response: '...',
    message_id: '...',
    parent_message_id: '...'
  }
  `;
  
    return prompt;
  }

async function callOllama(conversation){
  const url = 'http://olama.jugaadtravel.com:5678/webhook/process-lead';
  const payload = {
    conversationThread: conversation.conversationThread,
    currentEmail: conversation.currentEmail
  };

  
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    

    const result = (response.data);
    return result;

  
}

// Function to trigger the OpenAI API
async function openaitrigger(emailBody) {
  console.log(emailBody);
  const processedPrompt = Array.isArray(emailBody) ? JSON.stringify(emailBody) : emailBody;
  const OPENAI_API_KEY = process.env.OPENAPI_KEY;
  const payload = {
    model: 'gpt-4',
    messages: [
      { role: 'user', content: processedPrompt }
    ],
    max_tokens: 300
  };

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const result = response.data;

    // Clean and decode the response
    const sanitizedResponse = sanitizeOpenAIResponse(result.choices[0].message.content);

    return JSON5.parse(sanitizedResponse);

  } catch (error) {
    console.error("OpenAI API Error:", error.message);
    return null;
  }
}

// Function to sanitize the OpenAI response
function sanitizeOpenAIResponse(response) {
  // Implement your sanitization logic here
  return response;
}