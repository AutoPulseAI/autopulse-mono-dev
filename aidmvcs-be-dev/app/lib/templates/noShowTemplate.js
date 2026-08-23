export const noShowEmailTemplate = (customerName, vehicleModel, dealerName, dealerUrl) => ({
  subject: 'We missed you today — let\'s reschedule your visit',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>No-Show Follow-up</title>
      <style>
        body { font-family: 'Open Sans', Helvetica, Arial, sans-serif; line-height: 1.6; color: #444; max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background-color: #6c757d; padding: 30px 20px; text-align: center; color: white; }
        .content { padding: 25px; }
        .cta-button { display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #999; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>We Missed You Today</h1>
      </div>
      
      <div class="content">
        <p>Hi ${customerName},</p>
        
        <p>We noticed you couldn't make it to your scheduled appointment today — we completely understand, things happen!</p>
        
        <p>Would you like to reschedule your ${vehicleModel ? vehicleModel + ' ' : ''}appointment for another day or time that works better for you? Just reply to this email or click below to pick a new slot.</p>
        
        <p style="text-align: center;">
          <a href="${dealerUrl || '#'}" class="cta-button">👉 Reschedule My Appointment</a>
        </p>
        
        <p>We hope to see you soon!</p>
        
        <br>
        
        <p>Warm regards,<br>The ${dealerName} Team</p>
        
        ${dealerUrl ? `<p><a href="${dealerUrl}">Visit our website</a></p>` : ''}
      </div>
      
      <div class="footer">
        <p>© ${new Date().getFullYear()} ${dealerName}. All rights reserved.</p>
      </div>
    </body>
    </html>
  `,
});

export const noShowSMSTemplate = (customerName, dealerName, dealerUrl) => {
  const urlText = dealerUrl ? ` ${dealerUrl}` : '';
  return `Hey ${customerName}, we missed you today!\n\nWhat day and time would you like to reschedule for?${dealerName}${urlText}`;
};

