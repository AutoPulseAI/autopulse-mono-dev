export const adminTemplate = (name) => ({
    subject: 'Your Admin Account is Ready - Action Required',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Account Created</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2c3e50; padding: 20px; text-align: center; }
          .header h1 { color: #fff; margin: 0; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #3498db; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; }
          .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #777; }
          .steps { background-color: #f0f7fd; padding: 15px; border-left: 4px solid #3498db; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Admin Portal Access</h1>
        </div>
        <div class="content">
          <h2>Dear ${name},</h2>
          <p>Your administrator account has been successfully configured with elevated privileges.</p>
          
          <div class="steps">
            <h3>Next Steps:</h3>
            <ol>
              <li><strong>Secure your account</strong> by changing your temporary password immediately</li>
              <li>Enable <strong>two-factor authentication</strong> for added security</li>
              <li>Review the <strong>admin handbook</strong> in your dashboard</li>
            </ol>
          </div>
          
          <p><strong>Important:</strong> As an administrator, you now have access to sensitive systems. Please review our security policies.</p>
          
          <p style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_BASE_URL}/admin/login" class="button">Access Admin Dashboard</a>
          </p>
          
          <p>If you did not request this account or believe this is an error, please contact <a href="mailto:security@yourcompany.com">security@yourcompany.com</a> immediately.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Your Company Name. All rights reserved.</p>
          <p>This email was sent to you as part of your administrative account setup.</p>
        </div>
      </body>
      </html>
    `,
  });