import { NextResponse } from 'next/server';
import User from '@models/User';
import Subscription from '@models/Subscription';
import dbConnect from '@lib/mongodb';

export async function dealersubscriptionMiddleware(req, user) {
  await dbConnect();

  const { pathname, origin } = req.nextUrl;

  // a) Exact‐only public pages
  const exactPaths = [
    '/dealer', 
    '/dealer/forgot-password', 
   
    '/dealer/register',         // login
    '/dealer/register', // register entry point
    '/dealer/subscribe/*',       // subscribe page
    '/dealer/subscribe', 
    '/dealer/subscribe/success',
    '/dealer/billing'         // billing page
  ];

  // b) Prefix public APIs
  const prefixPaths = [
    '/api/auth',
    '/api/subscriptions',
    '/dealer/reset', 
  ];

  const isExact = exactPaths.includes(pathname);
  const isPrefixed = prefixPaths.some(p => pathname === p || pathname.startsWith(p + '/'));

  if (isExact || isPrefixed) {
    // no subscription check here
    return null;
  }

  // c) Must have come through authMiddleware
  if (!user) {
    // safety‑net: if somehow auth was skipped, send to login
    return NextResponse.redirect(new URL('/dealer', origin));
  }

  // d) Check the subscription in your DB
  try {
    const parent_id = user.parent_id??user._id
    

    const fullUser = await User
      .findById(parent_id)
      .populate('current_subscription');
    if(!fullUser.vendor_id){
      const hasActiveSubscription =
        fullUser.current_subscription &&
        new Date(fullUser.current_subscription.end_date) > new Date();

      if (!hasActiveSubscription) {
        // no valid plan → send to /subscribe
        return NextResponse.redirect(new URL('/dealer/subscribe', origin));
      }
    }

    // all good
    return null;
  } catch (error) {
    console.error('Subscription check error:', error);
    return NextResponse.redirect(new URL('/dealer', origin));
  }
}
