import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import mongoose from 'mongoose';
import Vehicle from '@models/Vehicle';
import VehicleClick from '@models/VehicleClick';

export async function GET(request, { params }) {
  try {
    // In Next.js 15+, params is a Promise that must be awaited
    const { code } = await params;
    console.log('Short URL requested:', code);
    
    const userAgent = request.headers.get('user-agent') || '';
    const isBot = /bot|crawl|spider|facebookexternalhit|Twitterbot|Pinterest|LinkedInBot/.test(userAgent);

    await dbConnect();
    console.log('Database connected');
    
    let vehicle = await Vehicle.findOne({ shortCode: code });
    console.log('Vehicle lookup result:', {
      found: !!vehicle,
      shortCode: vehicle?.shortCode,
      hasInventoryUrl: !!vehicle?.inventoryUrl,
      inventoryUrl: vehicle?.inventoryUrl
    });
    if(!vehicle){
      vehicle = await Vehicle.findOne({ vin: code.toUpperCase()});
    }

    if (!vehicle) {
      console.error('Vehicle not found with shortCode:', code);
      return new NextResponse(
        JSON.stringify({ 
          error: 'Short URL not found', 
          code: code,
          message: 'No vehicle found with this short code'
        }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!vehicle.inventoryUrl) {
      console.error('Vehicle found but missing inventoryUrl:', code);
      return new NextResponse(
        JSON.stringify({ 
          error: 'Invalid vehicle configuration', 
          code: code,
          message: 'Vehicle exists but has no inventory URL'
        }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Track the click (non-blocking - don't wait for it to complete)
    try {
      const url = new URL(request.url, `http://${request.headers.get('host') || 'localhost'}`);
      const source = url.searchParams.get('source'); // Optional: ?source=email or ?source=sms
      
      // Get IP address
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                 request.headers.get('x-real-ip') || 
                 'unknown';
      
      // Get referrer
      const referrer = request.headers.get('referer') || request.headers.get('referrer') || '';

      // Create click record (fire and forget - don't block redirect)
      // Convert dealerId (string) to ObjectId if it's a valid ObjectId string
      const dealerIdValue = vehicle.dealerId || vehicle.dealer_id;
      let dealerIdFinal = dealerIdValue;
      
      // Try to convert string to ObjectId if it's a valid ObjectId format
      if (typeof dealerIdValue === 'string' && mongoose.Types.ObjectId.isValid(dealerIdValue)) {
        dealerIdFinal = new mongoose.Types.ObjectId(dealerIdValue);
      }
      
      VehicleClick.create({
        dealer_id: dealerIdFinal,
        vehicle_id: vehicle._id,
        vin: vehicle.vin,
        shortCode: code,
        isBot: isBot,
        userAgent: userAgent,
        ip: ip,
        referrer: referrer,
        source: source && ['email', 'sms'].includes(source.toLowerCase()) ? source.toLowerCase() : null,
        clickedAt: new Date()
      }).catch(err => {
        // Log error but don't block redirect
        console.error('Error tracking vehicle click:', err);
      });
    } catch (trackingError) {
      // Log error but don't block redirect
      console.error('Error in click tracking setup:', trackingError);
    }

    console.log('Redirecting to:', vehicle.inventoryUrl);
    console.log('Is bot:', isBot);

    if (isBot) {
      // Return HTML with meta tags for crawlers
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="${vehicle.title || 'Vehicle Listing'}" />
            <meta property="og:description" content="${vehicle.description || 'Check out this vehicle'}" />
            <meta property="og:image" content="${vehicle.imageUrl || 'https://autopulse.ai/default-image.jpg'}" />
            <meta property="og:url" content="${vehicle.inventoryUrl}" />
            <meta name="twitter:card" content="summary_large_image">
          </head>
          <body>
            <script>
              window.location.href = "${vehicle.inventoryUrl}";
            </script>
          </body>
        </html>
      `;
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      });
    }

    // For regular users, redirect
    return NextResponse.redirect(vehicle.inventoryUrl, 302);
    
  } catch (error) {
    console.error('Error in /v/[code] route:', error);
    return new NextResponse(
      JSON.stringify({ 
        error: 'Internal server error', 
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}