export const announcementTemplateHTML = `
<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
  <!-- Header Banner -->
  <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 50px 20px; text-align: center;">
    <div style="background-color: rgba(255, 255, 255, 0.2); border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
      <span style="font-size: 40px;">🎉</span>
    </div>
    <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">Important Update</h1>
    <p style="color: #ffffff; margin: 15px 0 0 0; font-size: 18px; opacity: 0.95;">We're thrilled to share this with you!</p>
  </div>

  <!-- Main Image -->
  <div style="text-align: center; padding: 40px 20px; background-color: #f8f9fa;">
    <img src="https://images.unsplash.com/photo-1551434678-e076c223a692?w=600&h=350&fit=crop" alt="Announcement" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.1);" />
  </div>

  <!-- Content Section -->
  <div style="padding: 40px 30px;">
    <h2 style="color: #2c3e50; font-size: 26px; margin-bottom: 20px; text-align: center;">What's New?</h2>
    <p style="color: #555555; font-size: 16px; line-height: 1.8; margin-bottom: 25px; text-align: justify;">
      We're excited to announce significant improvements to our services. These enhancements are designed to provide you with a better experience and more value.
    </p>

    <!-- Features Grid -->
    <div style="margin: 40px 0;">
      <div style="display: table; width: 100%; border-collapse: separate; border-spacing: 15px;">
        <div style="display: table-row;">
          <div style="display: table-cell; width: 50%; background-color: #e8f5e9; padding: 20px; border-radius: 8px; vertical-align: top;">
            <div style="font-size: 32px; margin-bottom: 10px;">✨</div>
            <h3 style="color: #2c3e50; font-size: 18px; margin-bottom: 10px;">Enhanced Features</h3>
            <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 0;">New and improved functionality to make your experience even better.</p>
          </div>
          <div style="display: table-cell; width: 50%; background-color: #e3f2fd; padding: 20px; border-radius: 8px; vertical-align: top;">
            <div style="font-size: 32px; margin-bottom: 10px;">🚀</div>
            <h3 style="color: #2c3e50; font-size: 18px; margin-bottom: 10px;">Better Performance</h3>
            <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 0;">Faster loading times and improved reliability across all platforms.</p>
          </div>
        </div>
        <div style="display: table-row;">
          <div style="display: table-cell; width: 50%; background-color: #fff3e0; padding: 20px; border-radius: 8px; vertical-align: top;">
            <div style="font-size: 32px; margin-bottom: 10px;">🎯</div>
            <h3 style="color: #2c3e50; font-size: 18px; margin-bottom: 10px;">Easy to Use</h3>
            <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 0;">Simplified interface designed with user experience in mind.</p>
          </div>
          <div style="display: table-cell; width: 50%; background-color: #fce4ec; padding: 20px; border-radius: 8px; vertical-align: top;">
            <div style="font-size: 32px; margin-bottom: 10px;">💎</div>
            <h3 style="color: #2c3e50; font-size: 18px; margin-bottom: 10px;">Premium Quality</h3>
            <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 0;">Top-tier service quality that you can always count on.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Video Tutorial -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px; margin: 40px 0; text-align: center;">
      <h3 style="color: #ffffff; font-size: 22px; margin-bottom: 20px;">📹 Watch How It Works</h3>
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="max-width: 100%; width: 560px; height: 315px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);"></iframe>
      <p style="color: #f0f0f0; font-size: 14px; margin-top: 15px;">Learn how to get the most out of our new features</p>
    </div>

    <!-- Additional Image -->
    <div style="text-align: center; margin: 30px 0;">
      <img src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=250&fit=crop" alt="Additional Info" style="max-width: 100%; height: auto; border-radius: 8px;" />
    </div>

    <!-- CTA Section -->
    <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; text-align: center; margin: 30px 0;">
      <h3 style="color: #2c3e50; font-size: 22px; margin-bottom: 15px;">Ready to Get Started?</h3>
      <p style="color: #666666; font-size: 16px; margin-bottom: 25px;">Experience the new features today!</p>
      <a href="#" style="display: inline-block; background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(17, 153, 142, 0.4);">Explore Now</a>
    </div>

    <!-- Timeline -->
    <div style="border-left: 4px solid #11998e; padding-left: 20px; margin: 30px 0;">
      <h3 style="color: #2c3e50; font-size: 20px; margin-bottom: 15px;">What's Next?</h3>
      <div style="margin-bottom: 15px;">
        <strong style="color: #11998e;">January 2025:</strong>
        <span style="color: #666666; margin-left: 10px;">Launch of new features</span>
      </div>
      <div style="margin-bottom: 15px;">
        <strong style="color: #11998e;">February 2025:</strong>
        <span style="color: #666666; margin-left: 10px;">Enhanced user interface updates</span>
      </div>
      <div>
        <strong style="color: #11998e;">March 2025:</strong>
        <span style="color: #666666; margin-left: 10px;">Additional premium features release</span>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="background-color: #2c3e50; padding: 30px; text-align: center;">
    <p style="color: #ecf0f1; font-size: 16px; margin-bottom: 15px; font-weight: 300;">Thank you for being with us</p>
    <p style="color: #95a5a6; font-size: 12px; margin: 5px 0;">
      <a href="#" style="color: #3498db; text-decoration: none;">Visit Website</a> | 
      <a href="#" style="color: #3498db; text-decoration: none;">Contact Support</a>
    </p>
    <p style="color: #7f8c8d; font-size: 11px; margin-top: 15px;">
      <a href="#" style="color: #95a5a6; text-decoration: none;">Unsubscribe from these emails</a>
    </p>
  </div>
</div>
`.trim();

export const announcementTemplateData = {
  name: "Service Announcement Template",
  description: "Professional service announcement with images and instructional video",
  subject: "🎊 Exciting News - Important Update",
  category: "Announcement"
};

