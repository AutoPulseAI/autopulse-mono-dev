import { NextResponse } from 'next/server';
import { authMiddleware } from './app/agency/middleware/auth';
import { subscriptionMiddleware } from './app/agency/middleware/subscription';
import { dealerauthMiddleware } from './app/dealer/middleware/dealerauth';
import { dealersubscriptionMiddleware } from './app/dealer/middleware/dealersubscription';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
 
  // Public routes that skip all middleware
  if (pathname.startsWith('/auth') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }
  console.log(pathname);
  // Route to specific middleware based on path
  if (pathname.startsWith('/agency')) {
    
    return handleAgencyMiddleware(request);
  }

  if (pathname.startsWith('/admin')) {
    
    //return handleAdminMiddleware(request);
  }

  if (pathname.startsWith('/dealer')) {
    return handleDealerMiddleware(request);
  }

  if (pathname.startsWith('/admin')) {
    //return handleAdminMiddleware(request);
  }

  // Default response for unmatched routes
  return NextResponse.next();
}

async function handleAgencyMiddleware(request) {
  // First run auth check
  const { user, response: authRes } = await authMiddleware(request);
    if (authRes) {
      return authRes;                
    }
  
  
 
  const subscriptionResponse = await subscriptionMiddleware(request,user);
  if (subscriptionResponse?.status === 307 || subscriptionResponse?.redirected) {
    
    return subscriptionResponse;
  }

  return NextResponse.next();
}

async function handleDealerMiddleware(request) {

  const { user, response: authRes } = await dealerauthMiddleware(request);
    if (authRes) {
      return authRes;                
    }
  
  
 
  const subscriptionResponse = await dealersubscriptionMiddleware(request,user);
  if (subscriptionResponse?.status === 307 || subscriptionResponse?.redirected) {
    
    return subscriptionResponse;
  }

  return NextResponse.next();
}

async function handleAdminMiddleware(request) {
  const authResponse = await adminAuthMiddleware(request);
  if (authResponse?.redirected) return authResponse;

  const subscriptionResponse = await subscriptionMiddleware(request);
  if (subscriptionResponse?.redirected) return subscriptionResponse;

  return NextResponse.next();
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    "/agency",
    "/agency/:path*",
    "/agency/register/:path*",
    "/dealer",
    "/dealer/:path*",
    "/dealer/register/:path*",
    // Do NOT include /api/auth here — Next.js 16 proxy treats matched
    // paths as app routes and /api/auth/* returns 404 instead of route handlers.
  ],
};