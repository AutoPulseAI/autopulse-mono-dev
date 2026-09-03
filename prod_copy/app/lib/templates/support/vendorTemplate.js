import { baseTemplate } from '../baseTemplate';

export const ticketvendorTemplate = (ticket, creator) => {
  const ticketIdentifier = ticket.ticketNumber || ticket._id;
  const subject = `📩 New Support Ticket [#${ticketIdentifier}] from ${creator.name}`;
  
  const content = `
    <h3 style="margin-top: 0; color: #2d3748;">New Support Ticket from Your Dealer</h3>
    
    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Dealer:</span>
        <span class="detail-value">${creator.name}</span>
      </div>
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
    </div>
    
    <h4 style="color: #2d3748; margin-bottom: 10px;">Description:</h4>
    <p style="white-space: pre-line;">${ticket.description}</p>
    
    <p style="margin-top: 20px; color: #4a5568;">
      Please coordinate with the dealer or support team as needed.
    </p>
  `;

  const html = baseTemplate(content, subject, {
    url: `${process.env.NEXT_PUBLIC_BASE_URL}/vendor/tickets/${ticket._id}`,
    text: 'View Ticket Details'
  });

  return { subject, html };
};