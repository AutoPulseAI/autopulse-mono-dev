import { baseTemplate } from '../baseTemplate';

export const ticketconfirmationTemplate = (ticket, creator) => {
  const ticketIdentifier = ticket.ticketNumber || ticket._id;
  const subject = `✅ Ticket Created [#${ticketIdentifier}]: ${ticket.title}`;
  
  const content = `
    <h3 style="margin-top: 0; color: #2d3748;">Your Support Ticket Has Been Created</h3>
    
    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Ticket ID:</span>
        <span class="detail-value">#${ticketIdentifier}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Title:</span>
        <span class="detail-value">${ticket.title}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Priority:</span>
        <span class="detail-value">${ticket.priority.toUpperCase()}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status:</span>
        <span class="detail-value" style="color: #38a169;">${ticket.status.toUpperCase()}</span>
      </div>
    </div>
    
    <h4 style="color: #2d3748; margin-bottom: 10px;">Description:</h4>
    <p style="white-space: pre-line;">${ticket.description}</p>
    
    <p style="margin-top: 20px; color: #4a5568;">
      Our support team will review your ticket and respond soon. 
      You'll receive email updates when there are changes to your ticket.
    </p>
  `;

  const html = baseTemplate(content, subject, {
    url: `${process.env.NEXT_PUBLIC_BASE_URL}/tickets/${ticket._id}`,
    text: 'View Your Ticket'
  });

  return { subject, html };
};