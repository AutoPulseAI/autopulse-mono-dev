export const appointmentUpdateTemplate = (customerName, oldDate, oldTime, newDate, newTime, dealerName, dealerPhone, dealerAddress) => ({
  subject: `Appointment Updated - ${newDate}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Appointment Update</title>
      <style>
        body { font-family: 'Open Sans', Helvetica, Arial, sans-serif; line-height: 1.6; color: #444; max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background-color: #ffc107; padding: 30px 20px; text-align: center; color: #212529; }
        .update-banner { background-color: #fff3cd; padding: 20px; text-align: center; border-bottom: 1px solid #ffeaa7; }
        .appointment-details { background-color: #f8f9fa; padding: 25px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #ffc107; }
        .detail-row { display: flex; margin-bottom: 15px; }
        .detail-label { font-weight: bold; color: #495057; min-width: 120px; }
        .detail-value { color: #212529; }
        .old-details { background-color: #f8d7da; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .new-details { background-color: #d4edda; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .contact-info { background-color: #e9ecef; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #999; }
        .change-icon { color: #ffc107; font-size: 24px; margin-right: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🔄 Appointment Updated</h1>
      </div>
      
      <div class="update-banner">
        <p><strong>Your appointment has been updated!</strong></p>
      </div>
      
      <div style="padding: 25px;">
        <p>Dear ${customerName},</p>
        
        <p>We wanted to inform you that your appointment with ${dealerName} has been updated. Here are the changes:</p>
        
        <div class="appointment-details">
          <div class="old-details">
            <h4>📅 Previous Appointment:</h4>
            <div class="detail-row">
              <div class="detail-label">Date:</div>
              <div class="detail-value">${oldDate}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Time:</div>
              <div class="detail-value">${oldTime}</div>
            </div>
          </div>
          
          <div class="new-details">
            <h4>✅ Updated Appointment:</h4>
            <div class="detail-row">
              <div class="detail-label">Date:</div>
              <div class="detail-value">${newDate}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Time:</div>
              <div class="detail-value">${newTime}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Dealer:</div>
              <div class="detail-value">${dealerName}</div>
            </div>
            ${dealerAddress ? `
            <div class="detail-row">
              <div class="detail-label">Location:</div>
              <div class="detail-value">${dealerAddress}</div>
            </div>
            ` : ''}
          </div>
        </div>
        
        <div class="contact-info">
          <h3>📞 Contact Information</h3>
          <p><strong>Phone:</strong> ${dealerPhone}</p>
          <p>If you have any questions about this change or need to make further adjustments, please don't hesitate to contact us.</p>
        </div>
        
        <div style="background-color: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4>📋 Reminder:</h4>
          <p>Please update your calendar with the new appointment time. We look forward to seeing you on <strong>${newDate} at ${newTime}</strong>!</p>
        </div>
        
        <p>Thank you for your understanding, and we apologize for any inconvenience.</p>
        
        <p>Best regards,<br>The ${dealerName} Team</p>
      </div>
      
      <div class="footer">
        <p>© ${new Date().getFullYear()} ${dealerName}. All rights reserved.</p>
        <p>This is an automated update notification. Please save this email for your records.</p>
      </div>
    </body>
    </html>
  `,
});
