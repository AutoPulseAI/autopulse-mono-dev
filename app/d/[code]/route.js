import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import mongoose from 'mongoose';
import User from '@models/User';
import DealerWebsiteClick from '@models/DealerWebsiteClick';

export async function GET(request, { params }) {
  try {
    // In Next.js 15+, params is a Promise that must be awaited
    const { code } = await params;
    console.log('Dealer website short URL requested:', code);
    
    const userAgent = request.headers.get('user-agent') || '';
    const isBot = /bot|crawl|spider|facebookexternalhit|Twitterbot|Pinterest|LinkedInBot/.test(userAgent);

    await dbConnect();
    console.log('Database connected');
    
    // Find dealer by short code in dealer_account_information
    const dealer = await User.findOne({ 
      "dealer_account_information.store_website_short_code": code 
    });
    
    console.log('Dealer lookup result:', {
      found: !!dealer,
      shortCode: code,
      hasStoreWebsite: !!dealer?.dealer_account_information?.store_website,
      storeWebsite: dealer?.dealer_account_information?.store_website
    });

    if (!dealer) {
      console.error('Dealer not found with shortCode:', code);
      return new NextResponse(
        JSON.stringify({ 
          error: 'Short URL not found', 
          code: code,
          message: 'No dealer found with this short code'
        }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    let originalUrl = dealer.dealer_account_information?.store_website;
    if (!originalUrl) {
      console.error('Dealer found but missing store_website:', code);
      return new NextResponse(
        JSON.stringify({ 
          error: 'Invalid dealer configuration', 
          code: code,
          message: 'Dealer exists but has no store website URL'
        }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Normalize URL - ensure it has a protocol (https://)
    if (!originalUrl.match(/^https?:\/\//i)) {
      // If URL doesn't start with http:// or https://, add https://
      originalUrl = `https://${originalUrl}`;
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
      // Convert dealerId to ObjectId if it's a valid ObjectId string
      let dealerIdFinal = dealer._id;
      if (typeof dealer._id === 'string' && mongoose.Types.ObjectId.isValid(dealer._id)) {
        dealerIdFinal = new mongoose.Types.ObjectId(dealer._id);
      }
      
      // Store the normalized URL in the click record
      const normalizedUrlForTracking = originalUrl.match(/^https?:\/\//i) 
        ? originalUrl 
        : `https://${originalUrl}`;
      
      DealerWebsiteClick.create({
        dealer_id: dealerIdFinal,
        shortCode: code,
        originalUrl: normalizedUrlForTracking,
        isBot: isBot,
        userAgent: userAgent,
        ip: ip,
        referrer: referrer,
        source: source && ['email', 'sms'].includes(source.toLowerCase()) ? source.toLowerCase() : null,
        clickedAt: new Date()
      }).catch(err => {
        // Log error but don't block redirect
        console.error('Error tracking dealer website click:', err);
      });
    } catch (trackingError) {
      // Log error but don't block redirect
      console.error('Error in click tracking setup:', trackingError);
    }

    console.log('Redirecting to:', originalUrl);
    console.log('Is bot:', isBot);

    if (isBot) {
      // Return HTML with meta tags for crawlers
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="${dealer.name || 'Dealership Website'}" />
            <meta property="og:description" content="Visit ${dealer.name || 'our dealership'}" />
            <meta property="og:url" content="${originalUrl}" />
            <meta name="twitter:card" content="summary">
          </head>
          <body>
            <script>
              window.location.href = "${originalUrl}";
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
    return NextResponse.redirect(originalUrl, 302);
    
  } catch (error) {
    console.error('Error in /d/[code] route:', error);
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

