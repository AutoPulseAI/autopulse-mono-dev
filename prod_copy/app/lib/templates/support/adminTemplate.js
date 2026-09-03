import { baseTemplate } from '../baseTemplate';

/** Check if URL is likely an image (for inline display in email) */
function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(url) || /\/[^/]*\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(url);
}

/** Build HTML for ticket attachments (links + optional inline images for admin email) */
function attachmentsSection(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return '';
  }
  const items = attachments
    .filter((a) => a && (typeof a === 'string' ? a : a.url))
    .map((a) => {
      const url = typeof a === 'string' ? a : a.url;
      const isImage = isImageUrl(url);
      const link = `<a href="${url}" target="_blank" rel="noopener" style="color: #2b6cb0;">${url}</a>`;
      const img = isImage
        ? `<img src="${url}" alt="Attachment" style="max-width: 200px; max-height: 150px; display: block; margin: 8px 0; border: 1px solid #e2e8f0; border-radius: 4px;" />`
        : '';
      return `<div style="margin-bottom: 12px;">${img}${link}</div>`;
    })
    .join('');
  return `
    <h4 style="color: #2d3748; margin: 16px 0 8px;">Attachments (${attachments.length}):</h4>
    <div style="margin-bottom: 16px;">${items}</div>
  `;
}

export const ticketadminTemplate = (ticket, creator) => {
  const ticketIdentifier = ticket.ticketNumber || ticket._id;
  const subject = `🚨 New Support Ticket [#${ticketIdentifier}]: ${ticket.title}`;

  const attachmentsHtml = attachmentsSection(ticket.attachments);
  const priorityColor = ticket.priority === 'high' ? '#e53e3e' : ticket.priority === 'critical' ? '#9b2c2c' : '#2b6cb0';
  const description = (ticket.description || '(No description)').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const content = `
<tr>
  <td style="padding: 16px 24px; font-family: Arial, sans-serif; font-size: 14px; color: #2d3748; line-height: 1.6;">
    <h3 style="margin: 0 0 16px 0; color: #2d3748; font-size: 18px; font-weight: 600;">New Support Ticket Created</h3>
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 16px; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; width: 140px;"><strong style="color: #4a5568;">Ticket ID:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">#${ticketIdentifier}</td></tr>
      <tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;"><strong style="color: #4a5568;">Title:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">${(ticket.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td></tr>
      <tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;"><strong style="color: #4a5568;">Priority:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; color: ${priorityColor}; font-weight: 600;">${(ticket.priority || '').toUpperCase()}</td></tr>
      <tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;"><strong style="color: #4a5568;">Category:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">${(ticket.category || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td></tr>
      <tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;"><strong style="color: #4a5568;">Created by:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">${(creator.name || 'Unknown').replace(/</g, '&lt;')} (${(creator.email || '').replace(/</g, '&lt;')})</td></tr>
    </table>
    <h4 style="margin: 16px 0 8px 0; color: #2d3748; font-size: 14px; font-weight: 600;">Description / Content:</h4>
    <p style="margin: 0 0 16px 0; white-space: pre-wrap; word-break: break-word;">${description}</p>
    ${attachmentsHtml}
  </td>
</tr>
  `;

  const html = baseTemplate(content, subject, {
    url: `${process.env.NEXT_PUBLIC_BASE_URL}/admin/support`,
    text: 'View Ticket in Dashboard'
  });

  return { subject, html };
};