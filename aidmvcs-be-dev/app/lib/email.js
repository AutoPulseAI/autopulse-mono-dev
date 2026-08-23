import nodemailer from 'nodemailer';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { normalizeMessageId } from './messageIdUtils.js';

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
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Email</title>

<style>
 body{
    margin:0;
    padding:0
}
.mail_parent table{
    border-spacing:0
}
.mail_parent img{
    border:0;
    height:auto;
    line-height:100%;
    outline:none;
    text-decoration:none
}
.mail_parent p{
    display:block;
    margin:13px 0
}
@media only screen and (min-width:950px){
    .mail_parent .column-100{
        width:100%!important;
        max-width:100%
    }
    .mail_parent .column-50{
        width:50%!important;
        max-width:50%
    }
}
.mail_parent u~div .img-container img+div{
    display:none
}
.mail_parent .links-0272b4-underline a{
    color:${brandingInfo?.primaryColor || '#0272b4'};
    text-decoration:underline
}
.mail_parent .links-1A73E8-bold a{
    color:${brandingInfo?.primaryColor || '#0272b4'};
    text-decoration:none;
    font-weight:bold
}
.mail_parent .links-1A73E8-underline a{
    color:${brandingInfo?.primaryColor || '#0272b4'};
    text-decoration:underline
}
.mail_parent .links-1967D2-underline a{
    color:${brandingInfo?.primaryColor || '#0272b4'};
    text-decoration:underline
}
@media only screen and (min-width:950px){
    .mail_parent .padding-0px-90px-8px-90px{
        padding:0px 90px 8px 90px!important
    }
    .mail_parent .padding-8px-75px-8px-75px{
        padding:8px 75px 8px 75px!important
    }
    .mail_parent .padding-8px-25px-0px-25px{
        padding:8px 25px 0px 25px!important
    }
    .mail_parent .padding-0px-40px-20px-40px{
        padding:0px 40px 20px 40px!important
    }
    .mail_parent .padding-10px-20px-0px-0px{
        padding:10px 20px 0px 0px!important
    }
    .mail_parent .margin-0-auto-0-0{
        margin:0 auto 0 0!important
    }
    .mail_parent .img-full-width{
        max-width:100%!important
    }
    .mail_parent .text-align-left{
        text-align:left!important
    }
    .mail_parent .padding-10px-0px-10px-0px{
        padding:10px 0px 10px 0px!important
    }
    .mail_parent .padding-0px-0px-10px-0px{
        padding:0px 0px 10px 0px!important
    }
    .mail_parent .padding-0px-20px-0px-0px{
        padding:0px 20px 0px 0px!important
    }
    .mail_parent .padding-8px-10px-20px-10px{
        padding:8px 10px 20px 10px!important
    }
    .mail_parent .padding-32px-30px-25px-30px{
        padding:32px 30px 25px 30px!important
    }
    .mail_parent .padding-10px-65px-10px-65px{
        padding:10px 65px 10px 65px!important
    }
    .mail_parent .img-container {
      padding: 25px 25px 24px 25px !important;
    }
    .mail_parent .top-space {
      line-height: 32px !important;
      height: 32px !important;
    }
}
.mail_parent p{
    margin:0 0
}
.mail_parent ul{
    display:block
}
.mail_parent sup,.mail_parent sub{
    line-height:0
}
.mail_parent body a{
    text-decoration:none;
    color:${brandingInfo?.primaryColor || '#0272b4'}
}
.mail_parent .image-highlight{
}
.mail_parent .image-highlight:hover{
}
.mail_parent .button-highlight{
}
.mail_parent .button-highlight:hover{
}
@media only screen and (min-width:950px){
    .mail_parent .hide-on-mobile{
        display:block!important
    }
    .mail_parent .hide-on-desktop{
        display:none!important
    }
}
.mail_parent .hide-on-desktop{
    display:block
}
.mail_parent .hide-on-mobile{
    display:none
}
.mail_parent [class~="x_body"]{
    width:99.9%
}
</style>

</head>
<body>
<div style="background-color:#f1f3f4;background-position:center center;background-size:auto;background-repeat:repeat" class="mail_parent">
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div style="Margin:0px auto;border-radius:0;max-width:600px">
            <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-radius:0">
              <tbody>
                <tr>
                  <td style="border-radius:0;font-size:0px;padding:0px;text-align:center;vertical-align:top">
                    <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                        <tbody>
                          <tr>
                            <td style="font-size:0px;padding:0 0 0 0;word-break:break-word">
                              <div class="top-space" style="line-height:0;height:0">&nbsp;</div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div role="presentation">
            <div style="background:#ffffff;background-color:#ffffff;Margin:0px auto;border-radius:0 0 0px 0px;max-width:600px">
              <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;width:100%;border-radius:12px 12px 0px 0px">
                <tbody>
                  <tr>
                    <td style="border-radius:12px 12px 0px 0px;font-size:0px;padding:0px 0px 0px 0px;text-align:center;vertical-align:top">
                      <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                          <tbody>
                            ${brandingInfo.bannerImage ? `
                              <tr>
                                <td class="img-container" style="font-size:0px;padding:0 0 5px 0;word-break:break-word;text-align:center">
                                  <div style="margin:0 auto;max-width:550px">
                                    <a href="" style="text-decoration:none;color:${brandingInfo?.primaryColor || '#0272b4'}" target="_blank">
                                      <img alt="Banner" height="auto" width="550" src="${brandingInfo?.bannerImage.url}" style="border:none;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;display:block" class="CToWUd">
                                    </a>
                                  </div>
                                </td>
                              </tr>
                            ` : ''}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div style="background:#ffffff;background-color:#ffffff;Margin:0px auto;max-width:600px">
            <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;width:100%;">
              <tbody>
                <tr>
                  <td style="font-size:0px;padding:0px 0px 20px 0px;text-align:center;vertical-align:top">
                    <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                      <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                        <tbody>
                          <tr>
                            <td style="background-color:transparent;border-radius:0px;vertical-align:top;padding:5px 0px 5px 0px">
                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                                <tbody>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 15px 8px 15px;word-break:break-word;text-align:left;">
                                      <div class="links-0272b4-underline">
                                        <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:${brandingInfo.titleColor || '#262A2A'};">
                                          ${content}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td class="padding-8px-75px-8px-75px" style="font-size:0px;padding:8px 15px 8px 15px;word-break:break-word;text-align:left">
                                      <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:15px;letter-spacing:none;line-height:1.50;text-align:left;color:${brandingInfo.titleColor || '#262A2A'};">
                                          <p style="margin:0 0">Best regards,</p>
                                          <p style="margin:0 0"><b>${dealer.dealer_account_information.ai_bot_name || ''}</b></p>
                                        </div>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%">
    <tbody>
      <tr>
        <td align="center">
          <div style="background:transparent;background-color:transparent;Margin:0px auto;border-radius:0;max-width:600px">
            <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:transparent;width:100%;border-radius:0">
              <tbody>
                <tr>
                  <td style="border-radius:0;font-size:0px;padding:20px 0px 40px 0px;text-align:center;vertical-align:top">
                    <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                      <tbody>
                        <tr>
                          <td style="background-color:transparent;line-height:0;font-size:0;direction:ltr;border-radius:0px">
                            <div class="column-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%">
                              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-radius:0px;vertical-align:top" width="100%">
                                <tbody>
                                  ${brandingInfo.dealershipLogo ? `
                                    <tr>
                                      <td class="img-container" style="font-size:0px;padding:0px 0px 12px 0px;word-break:break-word;text-align:center">
                                        <div style="margin:0 auto;max-width:120px">
                                          <img alt="Logo" height="auto" width="120" src="${brandingInfo.dealershipLogo.url}" style="border:none;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;display:block" class="CToWUd">
                                        </div>
                                      </td>
                                    </tr>
                                  ` : ''}
                                  <tr>
                                    <td class="padding-10px-65px-10px-65px" style="font-size:0px;padding:10px 25px 10px 25px;word-break:break-word;text-align:center">
                                      <div style="font-family:'Google Sans Text',Arial,sans-serif;font-size:12px;letter-spacing:0px;line-height:1.4;text-align:center;color:#5f6368">
                                        <p style="margin:0 0">For any questions, please contact <a href="mailto:${brandingInfo.ccEmail || ''}" target="_blank" style="text-decoration:none;color:${brandingInfo?.primaryColor || '#0272b4'};">${brandingInfo.ccEmail || ''}</a> or call <a href="tel:${brandingInfo.ccNumber || ''}" target="_blank" style="text-decoration:none;color:${brandingInfo?.primaryColor || '#0272b4'}">${brandingInfo.ccNumber || ''}</a>.</p>
                                        <p style="margin:0 0">&nbsp;</p>
                                        <p style="margin:0 0">© ${new Date().getFullYear()} ${dealer.dealer_account_information.ai_bot_name || ''}.</p>
                                      </div>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
</body>
</html>
  `;
};

const useSesSendRaw = () =>
  String(process.env.USE_SES_SEND_RAW || '').toLowerCase() === 'true' ||
  process.env.USE_SES_SEND_RAW === '1';

let sesClientSingleton = null;
function getSesClient() {
  if (!sesClientSingleton) {
    sesClientSingleton = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return sesClientSingleton;
}

function wrapBase64Lines(b64, lineLength = 76) {
  const lines = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    lines.push(b64.slice(i, i + lineLength));
  }
  return lines.join('\r\n');
}

/**
 * RFC 5322 raw message. We do NOT set Message-ID here because SES assigns one
 * like `<${sesMessageId}@email.amazonses.com>` and that's what clients reply to.
 * Body as UTF-8 HTML via base64 for safe transport.
 */
function buildRawHtmlEmail({ from, to, subject, html, threadingRef }) {
  const date = new Date().toUTCString();
  let raw = '';
  raw += `From: ${from}\r\n`;
  raw += `To: ${to}\r\n`;
  raw += `Subject: ${subject.replace(/\r?\n/g, ' ')}\r\n`;
  raw += `Date: ${date}\r\n`;
  raw += `MIME-Version: 1.0\r\n`;
  const ref = threadingRef ? normalizeMessageId(threadingRef) || String(threadingRef).trim() : '';
  if (ref) {
    raw += `In-Reply-To: ${ref}\r\n`;
    raw += `References: ${ref}\r\n`;
  }
  raw += `Content-Type: text/html; charset=UTF-8\r\n`;
  raw += `Content-Transfer-Encoding: base64\r\n`;
  raw += `\r\n`;
  const b64 = Buffer.from(html, 'utf8').toString('base64');
  raw += wrapBase64Lines(b64);
  raw += `\r\n`;
  return raw;
}

async function sendEmailViaSesRaw(to, subject, text, from, parentMessageId, dealer, attachments) {
  if (attachments && attachments.length > 0) {
    throw new Error(
      'SES raw send does not support attachments in this build; use SMTP or extend MIME builder.',
    );
  }

  const emailSubject = subject.startsWith('Re: ') ? subject.slice(4) : subject;
  const emailContent = dealer ? createBrandedEmailTemplate(text, dealer) : text;

  const raw = buildRawHtmlEmail({
    from,
    to,
    subject: emailSubject,
    html: emailContent,
    threadingRef: parentMessageId || null,
  });

  const command = new SendRawEmailCommand({
    RawMessage: { Data: Buffer.from(raw, 'utf8') },
    Source: from.includes('<') ? from.match(/<([^>]+)>/)?.[1]?.trim() || from : from,
    Destinations: [to.includes('<') ? to.match(/<([^>]+)>/)?.[1]?.trim() || to : to],
  });

  const response = await getSesClient().send(command);
  const deliveredMessageId = response?.MessageId
    ? `<${response.MessageId}@email.amazonses.com>`
    : '';
  console.log('Email sent via SES SendRawEmail', {
    deliveredMessageId,
    sesMessageId: response.MessageId,
    parentMessageId: parentMessageId || null,
  });
  return deliveredMessageId || response.MessageId;
}

export const sendEmail = async (to, subject, text, from, parentMessageId = null, dealer = null, attachments = []) => {
  console.log(to, subject, from, parentMessageId);
  const emailSubject = subject.startsWith('Re: ') ? subject.slice(4) : subject;
  console.log('Subject before sending:', emailSubject);

  const emailContent = dealer ? createBrandedEmailTemplate(text, dealer) : text;
  const mailOptions = {
    from: from, // Sender address
    to: to, // Recipient address
    subject: emailSubject, // Email subject
    html: emailContent,
  };

  // Add attachments if provided
  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map(att => {
      // Handle different attachment formats
      if (typeof att === 'string') {
        // If it's a URL string, treat as URL attachment
        return {
          filename: att.split('/').pop() || 'attachment',
          path: att
        };
      } else if (att.url) {
        // If it has a url property
        return {
          filename: att.filename || att.name || att.url.split('/').pop() || 'attachment',
          path: att.url,
          cid: att.contentId || att.cid, // For inline images
          contentType: att.mimeType || att.contentType
        };
      } else if (att.path) {
        // If it has a path property
        return {
          filename: att.filename || att.name || att.path.split('/').pop() || 'attachment',
          path: att.path,
          cid: att.contentId || att.cid,
          contentType: att.mimeType || att.contentType
        };
      }
      return att; // Return as-is if already in nodemailer format
    });
  }

  if (parentMessageId) {
    const ref =
      normalizeMessageId(parentMessageId) || String(parentMessageId).trim();
    mailOptions.headers = {
      'In-Reply-To': ref,
      References: ref,
    };
  }

  try {
    const sesEligible =
      useSesSendRaw() && (!attachments || attachments.length === 0);
    if (sesEligible) {
      return await sendEmailViaSesRaw(
        to,
        subject,
        text,
        from,
        parentMessageId,
        dealer,
        attachments,
      );
    }

    const info = await transporter.sendMail(mailOptions);
    const rawId = info.messageId;
    const canonical = normalizeMessageId(rawId) || (rawId != null && String(rawId).trim() ? String(rawId).trim() : '');
    console.log('Email sent successfully:', canonical || rawId);
    return canonical || rawId;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};