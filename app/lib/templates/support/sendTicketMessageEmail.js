import { baseTemplate } from '../baseTemplate';

export const sendTicketMessageEmailtemplate = (recipient, data) => {
  const subject = `New message on ticket #${data.ticketId}: ${data.ticketTitle}`;

  // Basic escaping to keep email layout safe
  const safeTitle = (data.ticketTitle || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeMessage = (data.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeSenderName = (data.senderName || 'Unknown').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeSenderEmail = (data.senderEmail || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Use table row/td so it renders correctly inside baseTemplate's <tbody>
  const content = `
<tr>
  <td style="padding: 16px 24px; font-family: Arial, sans-serif; font-size: 14px; color: #2d3748; line-height: 1.6;">
    <h2 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #2d3748;">
      New Message on Support Ticket
    </h2>
    <p style="margin: 0 0 4px 0;">
      <strong>Ticket:</strong>
      <span style="color: #1a73e8;">${safeTitle}</span>
      <span style="color: #4a5568;">(#${data.ticketId})</span>
    </p>
    <p style="margin: 0 0 12px 0;">
      <strong>From:</strong>
      ${safeSenderName}
      ${safeSenderEmail ? `(<a href="mailto:${safeSenderEmail}" style="color:#1a73e8;text-decoration:none;">${safeSenderEmail}</a>)` : ''}
    </p>
    <div style="margin: 12px 0 0 0; padding: 12px; border-radius: 6px; background-color: #f7fafc; border: 1px solid #e2e8f0;">
      <p style="margin: 0; white-space: pre-wrap; word-break: break-word;">
        ${safeMessage}
      </p>
    </div>
  </td>
</tr>
  `;

  const html = baseTemplate(content, subject, {
    url: `${process.env.NEXT_PUBLIC_BASE_URL}/admin/support`,
    text: 'View Ticket in Dashboard'
  });

  return { subject, html };
};