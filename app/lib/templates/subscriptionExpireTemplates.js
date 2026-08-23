// templates/subscriptionTemplates.js

export const subscriptionExpiredTemplates = {
    // ... existing templates ...
    
    expiryNotification: ({ name, isAgency, dealerInfo, expiryDate, renewalUrl }) => {
      const subject = isAgency 
        ? `Urgent: Your Agency Subscription Has Expired` 
        : `Action Required: Your Subscription Has Expired`;
      
      const dealerDetails = isAgency ? `
        <div style="margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 5px;">
          <h3 style="margin: 0 0 10px 0; color: #495057;">Affected Dealer</h3>
          <p style="margin: 5px 0;"><strong>Name:</strong> ${dealerInfo.name}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${dealerInfo.email}</p>
          <p style="margin: 5px 0;"><strong>ID:</strong> ${dealerInfo.id}</p>
        </div>
      ` : '';
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #495057;">
          <h2 style="color: #dc3545;">Subscription Expired</h2>
          <p>Dear ${name},</p>
          
          ${dealerDetails}
          
          <p>Your ${isAgency ? 'agency' : ''} subscription has expired${expiryDate ? ` on ${expiryDate.toLocaleDateString()}` : ''}.</p>
          
          <p style="font-weight: bold;">Important:</p>
          <ul>
            <li>All dealer accounts under your ${isAgency ? 'agency' : 'subscription'} will lose access to premium features</li>
            <li>Incoming emails may not be processed</li>
            <li>Some functionality may be restricted</li>
          </ul>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="${renewalUrl}" 
               style="display: inline-block; padding: 12px 24px; background-color: #28a745; color: white; 
                      text-decoration: none; border-radius: 5px; font-weight: bold;">
              Renew Now
            </a>
          </div>
          
          <p>If you believe this is an error or need assistance, please contact our support team at 
            <a href="mailto:${process.env.SUPPORT_EMAIL}">${process.env.SUPPORT_EMAIL}</a>.
          </p>
          
          <p style="margin-top: 30px; font-size: 0.9em; color: #6c757d;">
            This is an automated message. Please do not reply directly to this email.
          </p>
        </div>
      `;
      
      return { subject, html };
    },
    
    renewalConfirmation: ({ name, planName, expiryDate, billingCycle, amount, dashboardUrl }) => {
      const subject = `Subscription Renewal Confirmation: ${planName}`;
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #495057;">
          <h2 style="color: #28a745;">Subscription Renewed</h2>
          <p>Dear ${name},</p>
          
          <p>Thank you for renewing your subscription to <strong>${planName}</strong>.</p>
          
          <div style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 5px;">
            <h3 style="margin: 0 0 10px 0; color: #495057;">Renewal Details</h3>
            <p style="margin: 5px 0;"><strong>Plan:</strong> ${planName}</p>
            <p style="margin: 5px 0;"><strong>Billing Cycle:</strong> ${billingCycle}</p>
            <p style="margin: 5px 0;"><strong>Amount Paid:</strong> $${amount.toFixed(2)}</p>
            <p style="margin: 5px 0;"><strong>Expiry Date:</strong> ${expiryDate.toLocaleDateString()}</p>
          </div>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="${dashboardUrl}" 
               style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; 
                      text-decoration: none; border-radius: 5px; font-weight: bold;">
              Go to Dashboard
            </a>
          </div>
          
          <p style="margin-top: 30px; font-size: 0.9em; color: #6c757d;">
            This is an automated message. Please do not reply directly to this email.
          </p>
        </div>
      `;
      
      return { subject, html };
    },
    
    // ... add other template functions (upgradeNotification, paymentFailed, etc.) ...
  };