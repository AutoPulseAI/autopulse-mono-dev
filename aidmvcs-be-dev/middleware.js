import { NextResponse } from 'next/server';
import { authMiddleware } from './app/agency/middleware/auth';
import { subscriptionMiddleware } from './app/agency/middleware/subscription';
import { dealerauthMiddleware } from './app/dealer/middleware/dealerauth';
import { dealersubscriptionMiddleware } from './app/dealer/middleware/dealersubscription';
import { viewAsWriteRequest } from './app/lib/viewAs';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // "View as" an employee is look-only (app/lib/viewAs.js): no change is made with that sign-in. Other API calls pass
  // straight through (the API is matched only for this check).
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/cron')) {
    if (viewAsWriteRequest({ method: request.method, pathname, authorization: request.headers.get('authorization') })) {
      return NextResponse.json({ message: 'You are viewing as an employee: nothing can be changed. Go back to your own account to make changes.' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // `make crm-live-db`: this local copy runs against the live database, so the platform-wide cron jobs
  // (reports, CSV imports, campaigns, appointment reminders for every dealer) are the live servers' job, never ours.
  if (pathname.startsWith('/api/cron') && ['1', 'true', 'yes'].includes(String(process.env.CRM_LIVE_DB || '').toLowerCase())) {
    return NextResponse.json({ message: 'Cron jobs are disabled while running against the live database (CRM_LIVE_DB).' }, { status: 403 });
  }
 
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
    "/api/cron/:path*",
    // Every other API route except /api/auth (see below), only for the "view as" look-only check.
    "/api/((?!auth/).*)",
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