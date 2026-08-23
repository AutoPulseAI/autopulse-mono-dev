export const promotionTemplateHTML = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
  <!-- Header with Gradient -->
  <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 40px 20px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 36px; font-weight: bold; text-transform: uppercase;">Special Offer</h1>
    <p style="color: #ffffff; margin: 15px 0 0 0; font-size: 20px; font-weight: 300;">Don't Miss Out!</p>
  </div>

  <!-- Product Image -->
  <div style="text-align: center; padding: 40px 20px 20px 20px; background-color: #f8f9fa;">
    <img src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&h=400&fit=crop" alt="Product" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 8px 16px rgba(0,0,0,0.15);" />
  </div>

  <!-- Product Details -->
  <div style="padding: 30px;">
    <h2 style="color: #333333; font-size: 28px; margin-bottom: 10px; text-align: center;">Premium Product</h2>
    <p style="color: #f5576c; font-size: 32px; font-weight: bold; text-align: center; margin: 20px 0;">
      <span style="text-decoration: line-through; color: #999999; font-size: 24px;">$199.99</span>
      <span style="margin-left: 10px;">$149.99</span>
    </p>

    <!-- Video Demo -->
    <div style="text-align: center; margin: 30px 0; background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
      <h3 style="color: #333333; font-size: 20px; margin-bottom: 15px;">See It In Action</h3>
      <iframe src="https://www.youtube.com/embed/jNQXAC9IVRw" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="max-width: 100%; width: 560px; height: 315px; border-radius: 8px;"></iframe>
    </div>

    <!-- Features List -->
    <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin: 30px 0;">
      <h3 style="color: #333333; font-size: 20px; margin-bottom: 15px;">Key Features:</h3>
      <ul style="color: #666666; font-size: 16px; line-height: 2; padding-left: 20px; margin: 0;">
        <li>Premium quality materials</li>
        <li>30-day money-back guarantee</li>
        <li>Free shipping on all orders</li>
        <li>24/7 customer support</li>
      </ul>
    </div>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 40px 0;">
      <a href="#" style="display: inline-block; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #ffffff; padding: 18px 50px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4);">Shop Now - Save 25%</a>
    </div>

    <!-- Urgency Message -->
    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="color: #856404; font-size: 14px; margin: 0; font-weight: bold;">⏰ Offer expires in 7 days. Limited stock available!</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="background-color: #2c3e50; padding: 25px; text-align: center;">
    <p style="color: #ecf0f1; font-size: 14px; margin: 5px 0;">Thank you for your business</p>
    <p style="color: #bdc3c7; font-size: 12px; margin: 10px 0;">
      <a href="#" style="color: #3498db; text-decoration: none;">Unsubscribe</a>
    </p>
  </div>
</div>
`.trim();

export const promotionTemplateData = {
  name: "Product Promotion Template",
  description: "Eye-catching product promotion with images and video demonstration",
  subject: "🎉 Special Offer - Limited Time Only!",
  category: "Promotion"
};

