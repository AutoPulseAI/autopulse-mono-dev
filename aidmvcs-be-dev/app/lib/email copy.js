import nodemailer from 'nodemailer';

// Create a reusable transporter object using Mailgun's SMTP settings
const transporter = nodemailer.createTransport({
  host: process.env.THIRD_SMTP_HOST,
  port: process.env.THIRD_SMTP_PORT,
  secure: process.env.THIRD_SMTP_SECURE === 'true', // convert string to boolean
  auth: {
    user: process.env.THIRD_SMTP_USER,
    pass: process.env.THIRD_SMTP_PASSWORD,
  },
});

export const createBrandedEmailTemplate = (content, dealer) => {
  const brandingInfo = dealer.branding_information;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Email Template</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
          background-color: #f9f9f9;
        }
        .email-container {
          max-width: 600px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        .header {
          background-color: ${brandingInfo.headerColor || '#F9F9FC'};
          padding: 20px;
          text-align: center;
          border-bottom: 3px solid ${brandingInfo.primaryColor || '#0272b4'};
        }
        .logo {
          max-height: 80px;
          max-width: 100%;
        }
        .banner {
          width: 100%;
          max-height: 150px;
          object-fit: cover;
        }
        .content {
          padding: 20px;
          color: ${brandingInfo.titleColor || '#262a2a'};
        }
        .footer {
          background-color: ${brandingInfo.primaryColor || '#0272b4'};
          color: white;
          padding: 15px 20px;
          text-align: center;
          font-size: 12px;
        }
        .signature {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #eee;
        }
        .signature-name {
          font-weight: bold;
          color: ${brandingInfo.primaryColor || '#0272b4'};
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          ${brandingInfo.dealershipLogo ? `<img src="${brandingInfo.dealershipLogo.url}" alt="Dealership Logo" class="logo">` : ''}
          ${brandingInfo.bannerImage ? `<img src="${brandingInfo.bannerImage.url}" alt="Banner" class="banner">` : ''}
        </div>
        
        <div class="content">
          ${content}
          
          <div class="signature">
            <p>Best regards,</p>
            <p class="signature-name">${dealer.dealer_account_information.ai_bot_name || ''}</p>
            <p>Customer Care Assistant</p>
            <p>${brandingInfo.signatureStore || ''}</p>
          </div>
        </div>
        
        <div class="footer">
          <p>For any questions, please contact ${brandingInfo.ccEmail || ''} or call ${brandingInfo.ccNumber || ''}</p>
          <p>© ${new Date().getFullYear()} All Rights Reserved</p>
        </div>
      </div>
    </body>
    </html>
  `;
};


export const sendEmail = async (to, subject, text, from, parentMessageId = null,brandingInfo = null) => {
  console.log(to, subject, text, from, parentMessageId);
  const emailSubject = subject.startsWith('Re: ') ? subject.slice(4) : subject;
  console.log('Subject before sending:', emailSubject);

  const emailContent = brandingInfo ? createBrandedEmailTemplate(text, brandingInfo) : text;
  const mailOptions = {
    from: from, // Sender address
    to: to, // Recipient address
    subject: emailSubject, // Email subject
         
    html: emailContent,
  };

  // Add threading headers if parentMessageId is provided
  if (parentMessageId) {
    mailOptions.headers = {
      'In-Reply-To': `${parentMessageId}`, // In-Reply-To header
      'References': `${parentMessageId}`, // References header
    };
  }

  // Debugging: Log the mailOptions object to inspect headers
  console.log('Debugging mailOptions:', JSON.stringify(mailOptions, null, 2));

  try {
    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return info.messageId; // Return the Message-ID of the sent email
  } catch (error) {
    console.error('Error sending email:', error);
    throw error; // Re-throw the error for handling in the calling function
  }
};