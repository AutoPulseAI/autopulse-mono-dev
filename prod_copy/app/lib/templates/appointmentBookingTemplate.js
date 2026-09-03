export const appointmentBookingTemplate = (customerName, appointmentDate, appointmentTime, dealerName, dealerPhone, dealerAddress) => ({
  subject: `Appointment Confirmed - ${appointmentDate}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Appointment Confirmation</title>
      <style>
        body { font-family: 'Open Sans', Helvetica, Arial, sans-serif; line-height: 1.6; color: #444; max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background-color: #28a745; padding: 30px 20px; text-align: center; color: white; }
        .confirmation-banner { background-color: #d4edda; padding: 20px; text-align: center; border-bottom: 1px solid #c3e6cb; }
        .appointment-details { background-color: #f8f9fa; padding: 25px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #28a745; }
        .detail-row { display: flex; margin-bottom: 15px; }
        .detail-label { font-weight: bold; color: #495057; min-width: 120px; }
        .detail-value { color: #212529; }
        .contact-info { background-color: #e9ecef; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #999; }
        .success-icon { color: #28a745; font-size: 24px; margin-right: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🎉 Appointment Confirmed!</h1>
      </div>
      
      <div class="confirmation-banner">
        <p><strong>Your appointment has been successfully booked!</strong></p>
      </div>
      
      <div style="padding: 25px;">
        <p>Dear ${customerName},</p>
        
        <p>We're excited to confirm your appointment with ${dealerName}. Here are the details:</p>
        
        <div class="appointment-details">
          <div class="detail-row">
            <div class="detail-label">📅 Date:</div>
            <div class="detail-value">${appointmentDate}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">🕐 Time:</div>
            <div class="detail-value">${appointmentTime}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">🏢 Dealer:</div>
            <div class="detail-value">${dealerName}</div>
          </div>
          ${dealerAddress ? `
          <div class="detail-row">
            <div class="detail-label">📍 Location:</div>
            <div class="detail-value">${dealerAddress}</div>
          </div>
          ` : ''}
        </div>
        
        <div class="contact-info">
          <h3>📞 Contact Information</h3>
          <p><strong>Phone:</strong> ${dealerPhone}</p>
          <p>If you need to reschedule or have any questions, please don't hesitate to contact us.</p>
        </div>
        
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4>📋 What to Bring:</h4>
          <ul>
            <li>Valid driver's license</li>
            <li>Insurance information</li>
            <li>Any relevant documents</li>
          </ul>
        </div>
        
        <p>We look forward to seeing you on ${appointmentDate} at ${appointmentTime}!</p>
        
        <p>Best regards,<br>The ${dealerName} Team</p>
      </div>
      
      <div class="footer">
        <p>© ${new Date().getFullYear()} ${dealerName}. All rights reserved.</p>
        <p>This is an automated confirmation. Please save this email for your records.</p>
      </div>
    </body>
    </html>
  `,
});
