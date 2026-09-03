export const customerTemplate = (name) => ({
    subject: 'Welcome to [Company Name] - Start Exploring',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Our Community</title>
        <style>
          body { font-family: 'Open Sans', Helvetica, Arial, sans-serif; line-height: 1.6; color: #444; max-width: 600px; margin: 0 auto; padding: 0; }
          .header { background-color: #3498db; padding: 30px 20px; text-align: center; color: white; }
          .welcome-banner { background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 1px solid #eee; }
          .benefits { margin: 25px 0; }
          .benefit-item { display: flex; margin-bottom: 15px; }
          .benefit-icon { color: #3498db; font-size: 20px; margin-right: 15px; }
          .cta { background-color: #f0f7ff; padding: 20px; border-radius: 5px; text-align: center; margin: 25px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #999; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Welcome Aboard, ${name}!</h1>
        </div>
        
        <div class="welcome-banner">
          <p>We're thrilled to have you join the [Company Name] community!</p>
        </div>
        
        <div style="padding: 25px;">
          <p>Your account is all set up and ready to go. Here's what you can do now:</p>
          
          <div class="benefits">
            <div class="benefit-item">
              <div class="benefit-icon">✓</div>
              <div>
                <strong>Browse our catalog</strong> - Discover products tailored to your interests
              </div>
            </div>
            <div class="benefit-item">
              <div class="benefit-icon">✓</div>
              <div>
                <strong>Save favorites</strong> - Create wishlists for later
              </div>
            </div>
            <div class="benefit-item">
              <div class="benefit-icon">✓</div>
              <div>
                <strong>Track orders</strong> - Real-time updates on your purchases
              </div>
            </div>
            <div class="benefit-item">
              <div class="benefit-icon">✓</div>
              <div>
                <strong>Earn rewards</strong> - Start collecting points today
              </div>
            </div>
          </div>
          
          <div class="cta">
            <h3>Ready to Get Started?</h3>
            <p>Complete your profile to unlock personalized recommendations and special offers.</p>
            <a href="${process.env.NEXT_PUBLIC_BASE_URL}/account/profile" style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px; font-weight: bold;">Complete Your Profile</a>
          </div>
          
         
          <p>If you have any questions, our customer care team is here to help at <a href="mailto:support@yourcompany.com">support@yourcompany.com</a>.</p>
          
          <p>Happy exploring!<br>The [Company Name] Team</p>
        </div>
        
        <div class="footer">
          <p>© ${new Date().getFullYear()} [Company Name]. All rights reserved.</p>
          <p>
            <a href="#" style="color: #3498db; text-decoration: none; margin: 0 10px;">Help Center</a>
            <a href="#" style="color: #3498db; text-decoration: none; margin: 0 10px;">Privacy Policy</a>
            <a href="#" style="color: #3498db; text-decoration: none; margin: 0 10px;">Unsubscribe</a>
          </p>
        </div>
      </body>
      </html>
    `,
  });