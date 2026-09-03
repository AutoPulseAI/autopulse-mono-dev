export const welcomeTemplateHTML = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
  <!-- Header -->
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: bold;">Welcome Aboard!</h1>
    <p style="color: #f0f0f0; margin: 10px 0 0 0; font-size: 16px;">We're excited to have you with us</p>
  </div>

  <!-- Hero Image -->
  <div style="text-align: center; padding: 30px 20px;">
    <img src="https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&h=300&fit=crop" alt="Welcome" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
  </div>

  <!-- Main Content -->
  <div style="padding: 0 30px 30px 30px;">
    <h2 style="color: #333333; font-size: 24px; margin-bottom: 15px;">Hello {{name}},</h2>
    <p style="color: #666666; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
      Thank you for choosing us! We're thrilled to have you as part of our community. 
      Our team is dedicated to providing you with exceptional service and support.
    </p>

    <!-- Video Section -->
    <div style="text-align: center; margin: 30px 0;">
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="max-width: 100%; width: 560px; height: 315px; border-radius: 8px;"></iframe>
      <p style="color: #888888; font-size: 14px; margin-top: 10px;">Watch our welcome video to learn more</p>
    </div>

    <!-- Features Grid -->
    <div style="display: table; width: 100%; margin: 30px 0;">
      <div style="display: table-row;">
        <div style="display: table-cell; width: 50%; padding: 15px; vertical-align: top; border: 1px solid #e0e0e0; border-right: none;">
          <h3 style="color: #667eea; font-size: 18px; margin-bottom: 10px;">🎯 Get Started</h3>
          <p style="color: #666666; font-size: 14px; line-height: 1.5;">Explore our platform and discover all the amazing features we have to offer.</p>
        </div>
        <div style="display: table-cell; width: 50%; padding: 15px; vertical-align: top; border: 1px solid #e0e0e0;">
          <h3 style="color: #667eea; font-size: 18px; margin-bottom: 10px;">💬 Need Help?</h3>
          <p style="color: #666666; font-size: 14px; line-height: 1.5;">Our support team is here 24/7 to assist you with any questions.</p>
        </div>
      </div>
    </div>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 30px 0;">
      <a href="#" style="display: inline-block; background-color: #667eea; color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Get Started Now</a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #e0e0e0;">
    <p style="color: #888888; font-size: 12px; margin: 5px 0;">© 2025 All rights reserved.</p>
    <p style="color: #888888; font-size: 12px; margin: 5px 0;">
      <a href="#" style="color: #667eea; text-decoration: none;">Unsubscribe</a> | 
      <a href="#" style="color: #667eea; text-decoration: none;">Contact Us</a>
    </p>
  </div>
</div>
`.trim();

export const welcomeTemplateData = {
  name: "Welcome Email Template",
  description: "Professional welcome email with hero image and video introduction",
  subject: "Welcome - Let's Get Started!",
  category: "Welcome"
};

