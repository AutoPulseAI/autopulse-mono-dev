import nodemailer from 'nodemailer';
import { adminTemplate } from './templates/adminTemplate.js';
import { vendorTemplate } from './templates/vendorTemplate.js';
import { dealerTemplate } from './templates/dealerTemplate.js';
import { customerTemplate } from './templates/customerTemplate.js';
import { passwordResetTemplate } from './templates/passwordResetTemplate.js';
import { otpTemplate } from './templates/otpTemplate.js';
import { contactTemplate } from './templates/contactTemplate.js';
import { demoTemplate } from './templates/demoTemplate.js';
import { demoThanksTemplate } from './templates/demoThankingTemplate.js';
import { contactThankingTemplate } from './templates/contactThankingTemplate.js';
import { staffTemplate } from './templates/staffTemplate.js';
import { subscriptionTemplates } from './templates/subscriptionTemplates.js';
import { dealerSubscriptionConfirmTemplate } from './templates/dealerSubscriptionConfirmTemplate.js';

import { subscriptionExpiredTemplates } from './templates/subscriptionExpireTemplates.js';

import { ticketadminTemplate } from './templates/support/adminTemplate.js';
import { ticketvendorTemplate } from './templates/support/vendorTemplate.js';
import { ticketconfirmationTemplate } from './templates/support/confirmationTemplate.js';
import { ticketstatusUpdateTemplate } from './templates/support/statusUpdateTemplate.js';
import { sendTicketMessageEmailtemplate } from './templates/support/sendTicketMessageEmail.js';
import { subscriptionActivatedTemplate } from "./templates/subscriptionActivatedTemplate.js";

import User from "@models/User"; 
// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.mailgun.org",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true' || false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});



const templates = {
  admin: adminTemplate,
  vendor: vendorTemplate,
  dealer: dealerTemplate,
  customer: customerTemplate,
  staff: staffTemplate
};

/**
 * Send email using specified template
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.from] - Sender email
 */
export const sendEmail = async ({ to, subject, html, from, replyTo }) => {
  try {
    await transporter.sendMail({
      from: from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    console.log(`Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
    throw new Error('Failed to send email');
  }
};



/**
 * Send contact form submission email
 * @param {Object} contactData - Contact form data
 * @param {string} contactData.firstName - First name
 * @param {string} contactData.lastName - Last name
 * @param {string} contactData.email - Email address
 * @param {string} [contactData.phone] - Phone number (optional)
 * @param {string} contactData.message - Message content
 */
export const sendContactEmail = async (contactData) => {
    {
      const { subject, html } = contactThankingTemplate(contactData);
      sendEmail({
        to: contactData.email,
        subject,
        html,
       
      });
    }
  const { subject, html } = contactTemplate(contactData);
  
  
  return sendEmail({
    to: process.env.CONTACT_FORM_RECIPIENT || process.env.ADMIN_EMAIL,
    subject,
    html,
    from: `Autopluse.ai <${process.env.EMAIL_FROM}>`
  });
};

export const sendDemoRequestEmail = async (contactData) => {
  {
    const { subject, html } = demoThanksTemplate(contactData);
    sendEmail({
      to: contactData.email,
      subject,
      html,
    });
  }
  const { subject, html } = demoTemplate(contactData);

  return sendEmail({
    to: process.env.CONTACT_FORM_RECIPIENT || process.env.ADMIN_EMAIL,
    subject,
    html,
    from: `Autopluse.ai <${process.env.EMAIL_FROM}>`,
    replyTo: contactData.email,
  });
};

/**
 * Send registration email
 * @param {Object} options
 * @param {string} options.email - Recipient email
 * @param {string} options.name - Recipient name
 * @param {string} options.userType - Type of user (admin, vendor, dealer, customer)
 */
export const sendRegistrationEmail = async ({ email, name, userType }) => {
  const template = templates[userType.toLowerCase()] || customerTemplate;
  const { subject, html } = template(name);

  return sendEmail({
    to: email,
    subject,
    html,
  });
};

/**
 * Send password reset email
 * @param {Object} options
 * @param {string} options.email - Recipient email
 * @param {string} options.name - Recipient name
 * @param {string} options.resetLink - Password reset link
 */
export const sendPasswordResetEmail = async ({ email, name, resetLink }) => {
  const { subject, html } = passwordResetTemplate({ name, resetLink });

  return sendEmail({
    to: email,
    subject,
    html,
  });
};

/**
 * Send OTP email
 * @param {Object} options
 * @param {string} options.email - Recipient email
 * @param {string} options.name - Recipient name
 * @param {string} options.otp - OTP code
 * @param {string} options.userType - Type of user (admin, vendor, dealer, customer)
 * @param {string} [options.purpose] - Purpose of OTP (login, verification, etc.)
 */
export const sendOtpEmail = async ({ email, name, otp, userType, purpose = 'verification' }) => {
  const { subject, html } = otpTemplate({ 
    name, 
    otp, 
    userType: userType.toLowerCase(), 
    purpose 
  });

  return sendEmail({
    to: email,
    subject,
    html,
  });
};

/**
 * Send new-ticket notification to admin with full content (description + attachments).
 * Uses a dedicated path so admin always receives the complete ticket body and images.
 */
export const sendNewTicketAdminEmail = async (ticket, creator) => {
  const to = process.env.SUPPORT_TICKET_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'ravikathait01@yopmail.com';
  const { subject, html } = ticketadminTemplate(ticket, creator);
  await sendEmail({ to, subject, html });
};

export const sendTicketNotifications = async (ticket, creator) => {
  try {
    // 1. Send to admin with full content (description + attachments) via dedicated method
    await sendNewTicketAdminEmail(ticket, creator);

    // 2. If created by dealer with vendor, send to vendor
    if (creator.type === 'dealer' && creator.vendor_id) {
      const vendor = await User.findById(creator.vendor_id).select('email').lean();
      if (vendor?.email) {
        const { subject, html } = ticketvendorTemplate(ticket, creator);
        await sendEmail({ 
          to: vendor.email, 
          subject, 
          html 
        });
      }
    }

    // 3. Send confirmation to creator
    if (creator.email) {
      const { subject, html } = ticketconfirmationTemplate(ticket, creator);
      await sendEmail({ 
        to: creator.email, 
        subject, 
        html 
      });
    }

    return true;
  } catch (error) {
    console.error('Error sending ticket notifications:', error);
    throw error;
  }
};

export const sendTicketMessageEmail  = async(ticket, sender, messageContent )=> {
  try {
    // 1. Always notify admins
    const admins = await User.find({ type: 'admin' }).select('email').lean();
    
    // 2. Determine other recipients based on sender type
    let additionalRecipients = [];
    
    if (sender.type === 'admin') {
      // If admin replies, notify vendor and dealer
      const user = await User.findById(ticket.createdBy).select('email').lean();
      if (user) {
        additionalRecipients.push(user);
        if (user.vendor_id) {
          const vendor = await User.findById(user.vendor_id).select('email').lean();
          if (vendor) additionalRecipients.push(vendor);
        }
      }
    } 
    else if (sender.type === 'dealer') {
      // If dealer replies, notify vendor and admin
      if (sender.vendor_id) {
        const vendor = await User.findById(sender.vendor_id).select('email').lean();
        if (vendor) additionalRecipients.push(vendor);
      }
    } 
    else if (sender.type === 'vendor') {
      // If vendor replies, only notify admin (already handled)
    }

    // 3. Add configured copy mailbox for replies, if any
    const replyCopyEmail = process.env.SUPPORT_TICKET_REPLY_COPY_EMAIL || 'ravikathait01@gmail.com';
    if (replyCopyEmail) {
      additionalRecipients.push({
        email: replyCopyEmail
      });
    }

    // Prepare common email data
    const ticketIdentifier = ticket.ticketNumber || ticket._id;
    const emailData = {
      ticketId: ticketIdentifier,
      ticketTitle: ticket.title,
      message: messageContent,
      senderName: sender.name,
      senderEmail: sender.email,
      ticketUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/tickets/${ticket._id}`
    };

    // Send to all recipients
    const allRecipients = [...admins, ...additionalRecipients];
    const uniqueRecipients = Array.from(new Set(allRecipients.map(r => r.email)))
      .map(email => allRecipients.find(r => r.email === email));
    console.log(uniqueRecipients);
    await Promise.all(uniqueRecipients.map(async recipient => {
      if (!recipient._id || recipient._id.toString() !== sender._id.toString()) { // Don't notify self when applicable
        await sendTicketMessageEmailMessage(recipient.email, emailData);
      }
    }));

  } catch (error) {
    console.error('Error sending message notifications:', error);
    // Fail silently for email errors
  }
};

export const sendStaffAccountEmail = async ({ email, name, password, type, createdBy, loginUrl }) => {
  const { subject, html } = staffTemplate({ 
    name, 
    email, 
    password, 
    type, 
    createdBy, 
    loginUrl 
  });

  return sendEmail({
    to: email,
    subject,
    html,
  });
};

async function sendTicketMessageEmailMessage(recipient, data) {
  
  const { subject, html } = sendTicketMessageEmailtemplate(recipient, data);
  await sendEmail({ 
    to: recipient, 
    subject, 
    html 
  });
}

export const sendSubscriptionRequestAdminEmail = async (requestData) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const { subject, html } = subscriptionTemplates({
    ...requestData,
    adminUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/admin/subscriptions/requests/`
  });

  return sendEmail({
    to: adminEmail,
    subject,
    html
  });
};

/**
 * Send subscription expiry notification
 * @param {Object} options
 * @param {Object} options.account - The account (User model) whose subscription expired
 * @param {Object} [options.dealer] - The affected dealer (if account is an agency)
 * @param {string} [options.renewalUrl] - Custom renewal URL
 */
export const sendSubscriptionExpiryNotification = async ({ account, dealer = null, renewalUrl = null }) => {
  const isAgency = !!dealer;
  const recipientEmail = account.email;
  
  // Determine the appropriate template
  const { subject, html } = subscriptionExpiredTemplates.expiryNotification({
    name: account.name,
    isAgency,
    dealerInfo: dealer ? {
      name: dealer.name,
      email: dealer.email,
      id: dealer._id
    } : null,
    expiryDate: account.package_expiry ? new Date(account.package_expiry) : null,
    renewalUrl: renewalUrl || `${process.env.NEXT_PUBLIC_BASE_URL}/agency/subscribe`
  });

  try {
    await sendEmail({
      to: recipientEmail,
      subject,
      html,
      bcc: process.env.SUBSCRIPTION_NOTIFICATION_BCC || process.env.ADMIN_EMAIL
    });
    
    // Log successful notification
    await logNotification({
      type: 'subscription_expiry',
      recipient: account._id,
      dealerAffected: dealer?._id,
      emailSent: recipientEmail
    });
    
    return true;
  } catch (error) {
    console.error('Failed to send subscription expiry notification:', error);
    await logNotification({
      type: 'subscription_expiry',
      recipient: account._id,
      dealerAffected: dealer?._id,
      error: error.message,
      failed: true
    });
    return false;
  }
};

/**
 * Send subscription renewal confirmation
 * @param {Object} options
 * @param {Object} options.user - The user who renewed
 * @param {Object} options.subscription - The subscription details
 */
export const sendSubscriptionRenewalConfirmation = async ({ user, subscription }) => {
  const { subject, html } = subscriptionExpiredTemplates.renewalConfirmation({
    name: user.name,
    planName: subscription.package?.name || 'Your plan',
    expiryDate: subscription.expiry_date ? new Date(subscription.expiry_date) : null,
    billingCycle: subscription.billing_cycle,
    amount: subscription.amount_paid,
    dashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/dealer/dashboard`
  });

  return sendEmail({
    to: user.email,
    subject,
    html
  });
};

export const subscriptionActivatedmanual= async ({user,subscriptionData,pkg}) => {
 
  const { subject, html } = subscriptionActivatedTemplate(
    user.name,
    subscriptionData,
    pkg.toObject(),
    user.toObject());

    await sendEmail({
      to: user.email,
      subject: subject,
      html: html
    });
};

export const dealersubscriptionActivated= async ({user,subscriptionData,pkg}) => {
 
  const { subject, html } = dealerSubscriptionConfirmTemplate(
    user.name,
    subscriptionData,
    pkg.toObject(),
    user.toObject());

    await sendEmail({
      to: user.email,
      subject: subject,
      html: html
    });
};

/**
 * Send subscription upgrade notification
 * @param {Object} options
 * @param {Object} options.user - The user who upgraded
 * @param {Object} options.oldSubscription - Previous subscription details
 * @param {Object} options.newSubscription - New subscription details
 */
export const sendSubscriptionUpgradeNotification = async ({ user, oldSubscription, newSubscription }) => {
  const { subject, html } = subscriptionExpiredTemplates.upgradeNotification({
    name: user.name,
    oldPlan: oldSubscription.package?.name || 'Previous plan',
    newPlan: newSubscription.package?.name || 'New plan',
    effectiveDate: new Date(),
    billingCycle: newSubscription.billing_cycle,
    priceDifference: newSubscription.amount_paid - (oldSubscription.amount_paid || 0),
    dashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/dealer/dashboard`
  });

  return sendEmail({
    to: user.email,
    subject,
    html
  });
};

/**
 * Send payment failed notification
 * @param {Object} options
 * @param {Object} options.user - The user with failed payment
 * @param {Object} options.subscription - Subscription details
 * @param {string} options.error - Payment error message
 */
export const sendPaymentFailedNotification = async ({ user, subscription, error }) => {
  const { subject, html } = subscriptionExpiredTemplates.paymentFailed({
    name: user.name,
    planName: subscription.package?.name || 'Your plan',
    errorMessage: error,
    retryUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/agency/subscribe?retry_payment=true`,
    supportEmail: process.env.SUPPORT_EMAIL
  });

  return sendEmail({
    to: user.email,
    subject,
    html,
    bcc: process.env.BILLING_TEAM_EMAIL
  });
};
async function logNotification(data) {
  // Implement your logging mechanism here
  // Could save to database, send to logging service, etc.
  console.log('Notification logged:', data);
}
export async function resetPasswordAccountEmail({
  email,
  name,
  password,
  type,
  createdBy,
  loginUrl,
  isPasswordReset = false
}) {
  try {
    const subject = isPasswordReset 
      ? 'Your Password Has Been Reset' 
      : `Your ${type} Account Has Been Created`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">${subject}</h2>
        <p>Hello ${name},</p>
        
        ${isPasswordReset ? `
          <p>Your password has been reset by the administrator. Here are your new login details:</p>
        ` : `
          <p>Your ${type} account has been created. Here are your login details:</p>
        `}
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Password:</strong> ${password}</p>
        </div>
        
        <p>Please login at: <a href="${loginUrl}" style="color: #0066cc;">${loginUrl}</a></p>
        
        ${isPasswordReset ? `
          <p style="color: #ff0000; font-weight: bold;">
            For security reasons, we recommend changing your password after logging in.
          </p>
        ` : ''}
        
        <p>Best regards,<br>The Admin Team</p>
      </div>
    `;

    // Implementation for your email sending service (Nodemailer, SendGrid, etc.)
    // This is a placeholder - replace with your actual email sending code
    const transporter = nodemailer.createTransport({
      // your email transport configuration
    });

    return sendEmail({
      to: email,
      subject,
      html
    });

  

   
  } catch (error) {
    console.error("Email sending error:", error);
    throw error;
  }
}

// Export all functions
export default {
  sendEmail,
  sendRegistrationEmail,
  sendPasswordResetEmail,
  sendOtpEmail,
  sendContactEmail,
  sendDemoRequestEmail,
  sendTicketNotifications,
  sendTicketMessageEmail,
  sendStaffAccountEmail,
  sendSubscriptionRequestAdminEmail,
  sendPaymentFailedNotification,
  resetPasswordAccountEmail,
  sendSubscriptionExpiryNotification,
  subscriptionActivatedmanual,
  dealersubscriptionActivated
};