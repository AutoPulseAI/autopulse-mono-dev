export const newsletterTemplateHTML = `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
  <!-- Header -->
  <div style="background-color: #2c3e50; padding: 30px 20px; text-align: center;">
    <h1 style="color: #ecf0f1; margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 2px;">Monthly Newsletter</h1>
    <p style="color: #95a5a6; margin: 10px 0 0 0; font-size: 14px; text-transform: uppercase;">Stay Updated</p>
  </div>

  <!-- Hero Section -->
  <div style="position: relative; text-align: center;">
    <img src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=300&fit=crop" alt="Newsletter Hero" style="max-width: 100%; height: auto;" />
    <div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background-color: rgba(44, 62, 80, 0.9); padding: 15px 30px; border-radius: 5px;">
      <h2 style="color: #ffffff; margin: 0; font-size: 24px;">Latest Updates & News</h2>
    </div>
  </div>

  <!-- Main Content -->
  <div style="padding: 40px 30px;">
    <!-- Article 1 -->
    <div style="margin-bottom: 40px;">
      <div style="display: table; width: 100%;">
        <div style="display: table-cell; width: 40%; vertical-align: top; padding-right: 20px;">
          <img src="https://images.unsplash.com/photo-1486312338219-ce68e2c6f44d?w=300&h=200&fit=crop" alt="Article 1" style="max-width: 100%; height: auto; border-radius: 8px;" />
        </div>
        <div style="display: table-cell; width: 60%; vertical-align: top;">
          <h3 style="color: #2c3e50; font-size: 20px; margin-bottom: 10px; margin-top: 0;">New Features Available</h3>
          <p style="color: #7f8c8d; font-size: 14px; line-height: 1.6; margin-bottom: 15px;">Discover the latest improvements and enhancements we've made to serve you better.</p>
          <a href="#" style="color: #3498db; text-decoration: none; font-weight: bold; font-size: 14px;">Read More →</a>
        </div>
      </div>
    </div>

    <!-- Video Section -->
    <div style="background-color: #ecf0f1; padding: 30px; border-radius: 8px; margin: 40px 0; text-align: center;">
      <h3 style="color: #2c3e50; font-size: 22px; margin-bottom: 20px;">Featured Video</h3>
      <iframe src="https://www.youtube.com/embed/9bZkp7q19f0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="max-width: 100%; width: 560px; height: 315px; border-radius: 8px;"></iframe>
      <p style="color: #7f8c8d; font-size: 14px; margin-top: 15px;">Watch our latest video to learn more about what's new</p>
    </div>

    <!-- Article 2 -->
    <div style="margin-bottom: 40px;">
      <div style="display: table; width: 100%;">
        <div style="display: table-cell; width: 60%; vertical-align: top; padding-right: 20px;">
          <h3 style="color: #2c3e50; font-size: 20px; margin-bottom: 10px; margin-top: 0;">Customer Success Stories</h3>
          <p style="color: #7f8c8d; font-size: 14px; line-height: 1.6; margin-bottom: 15px;">Read about how our customers are achieving great results with our services.</p>
          <a href="#" style="color: #3498db; text-decoration: none; font-weight: bold; font-size: 14px;">Read More →</a>
        </div>
        <div style="display: table-cell; width: 40%; vertical-align: top;">
          <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=300&h=200&fit=crop" alt="Article 2" style="max-width: 100%; height: auto; border-radius: 8px;" />
        </div>
      </div>
    </div>

    <!-- Quick Stats -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 8px; margin: 40px 0;">
      <h3 style="color: #ffffff; font-size: 22px; text-align: center; margin-bottom: 25px;">This Month's Highlights</h3>
      <div style="display: table; width: 100%;">
        <div style="display: table-cell; width: 33.33%; text-align: center; padding: 10px;">
          <div style="color: #ffffff; font-size: 32px; font-weight: bold;">500+</div>
          <div style="color: #f0f0f0; font-size: 14px; margin-top: 5px;">Happy Customers</div>
        </div>
        <div style="display: table-cell; width: 33.33%; text-align: center; padding: 10px;">
          <div style="color: #ffffff; font-size: 32px; font-weight: bold;">98%</div>
          <div style="color: #f0f0f0; font-size: 14px; margin-top: 5px;">Satisfaction Rate</div>
        </div>
        <div style="display: table-cell; width: 33.33%; text-align: center; padding: 10px;">
          <div style="color: #ffffff; font-size: 32px; font-weight: bold;">24/7</div>
          <div style="color: #f0f0f0; font-size: 14px; margin-top: 5px;">Support Available</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="background-color: #34495e; padding: 30px; text-align: center;">
    <div style="margin-bottom: 20px;">
      <a href="#" style="display: inline-block; margin: 0 10px;"><img src="https://via.placeholder.com/32/3b5998/ffffff?text=f" alt="Facebook" style="width: 32px; height: 32px; border-radius: 50%;" /></a>
      <a href="#" style="display: inline-block; margin: 0 10px;"><img src="https://via.placeholder.com/32/1da1f2/ffffff?text=t" alt="Twitter" style="width: 32px; height: 32px; border-radius: 50%;" /></a>
      <a href="#" style="display: inline-block; margin: 0 10px;"><img src="https://via.placeholder.com/32/0077b5/ffffff?text=in" alt="LinkedIn" style="width: 32px; height: 32px; border-radius: 50%;" /></a>
    </div>
    <p style="color: #ecf0f1; font-size: 12px; margin: 5px 0;">© 2025 All rights reserved.</p>
    <p style="color: #95a5a6; font-size: 12px; margin: 10px 0;">
      <a href="#" style="color: #3498db; text-decoration: none;">Unsubscribe</a> | 
      <a href="#" style="color: #3498db; text-decoration: none;">Contact Us</a>
    </p>
  </div>
</div>
`.trim();

export const newsletterTemplateData = {
  name: "Newsletter Template",
  description: "Professional newsletter layout with multiple images and video content",
  subject: "Your Monthly Update",
  category: "Newsletter"
};

