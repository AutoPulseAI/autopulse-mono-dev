import { baseTemplate } from '../baseTemplate';

export const ticketstatusUpdateTemplate = (ticket, user, oldStatus, newStatus) => {
  const subject = `🔄 Ticket Update: ${ticket.title} (${oldStatus} → ${newStatus})`;
  
  const statusColors = {
    open: '#3182ce',
    in_progress: '#d69e2e',
    resolved: '#38a169',
    closed: '#718096'
  };
  
  const content = `
    <h3 style="margin-top: 0; color: #2d3748;">Ticket Status Updated</h3>
    
    <p style="color: #4a5568;">
      The status of your ticket has been updated by ${user.name} (${user.email}):
    </p>
    
    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Ticket ID:</span>
        <span class="detail-value">${ticket._id}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Title:</span>
        <span class="detail-value">${ticket.title}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Old Status:</span>
        <span class="detail-value" style="color: ${statusColors[oldStatus] || '#4a5568'}">
          ${oldStatus.toUpperCase()}
        </span>
      </div>
      <div class="detail-row">
        <span class="detail-label">New Status:</span>
        <span class="detail-value" style="color: ${statusColors[newStatus] || '#4a5568'}">
          ${newStatus.toUpperCase()}
        </span>
      </div>
    </div>
    
    ${ticket.resolution ? `
      <h4 style="color: #2d3748; margin-bottom: 10px;">Resolution:</h4>
      <p style="white-space: pre-line;">${ticket.resolution}</p>
    ` : ''}
  `;

  const html = baseTemplate(content, subject, {
    url: `${process.env.NEXT_PUBLIC_BASE_URL}/tickets/${ticket._id}`,
    text: 'View Updated Ticket'
  });

  return { subject, html };
};