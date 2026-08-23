import { NextResponse } from 'next/server';
import User from '@models/User';
import Subscription from '@models/Subscription';
import dbConnect from '@lib/mongodb';

export async function subscriptionMiddleware(req, user) {
  await dbConnect();

  const { pathname, origin } = req.nextUrl;

  // a) Exact‐only public pages
  const exactPaths = [
    '/agency', 
    '/agency/forgot-password', 
    '/agency/reset*', 
    '/agency/register',         // login
    '/agency/register', // register entry point
    '/agency/subscribe',       // subscribe page
    '/agency/subscribe/*',       // subscribe page
    '/agency/subscribe', 
    '/agency/subscribe/success',
    '/billing'         // billing page
  ];

  // b) Prefix public APIs
  const prefixPaths = [
    '/api/auth',
    '/api/subscriptions'
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
    return NextResponse.redirect(new URL('/agency', origin));
  }

  // d) Check the subscription in your DB
  try {
    const parent_id = user.parent_id??user._id
    const fullUser = await User
      .findById(parent_id)
      .populate('current_subscription');

    const hasActiveSubscription =
      fullUser.current_subscription &&
      new Date(fullUser.current_subscription.end_date) > new Date();

    if (!hasActiveSubscription) {
      // no valid plan → send to /subscribe
      return NextResponse.redirect(new URL('/agency/subscribe', origin));
    }

    // all good
    return null;
  } catch (error) {
    console.error('Subscription check error:', error);
    return NextResponse.redirect(new URL('/agency', origin));
  }
}
