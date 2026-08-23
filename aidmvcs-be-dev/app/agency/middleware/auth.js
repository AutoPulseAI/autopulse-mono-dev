import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import User from '@models/User';
import dbConnect from '@lib/mongodb';

export async function authMiddleware(req) {
  await dbConnect();

  const { pathname, origin } = req.nextUrl;

  // 1️⃣ Public pages: only skip on EXACT /agency (login) 
  //    or anything under /agency/register, or your auth API

  //console.log('▶ dealerAuthMiddleware sees:', pathname)

  // public pages (exact) or true prefixes (folder routes)
  const publicExact = ['/agency']
  const publicPrefixes = [
    '/agency/register',
    '/agency/forgot-password',    // note: use "forgot" if that's your folder
    '/agency/reset-password',
    '/api/auth'
  ]

  // exact match?
  if (publicExact.includes(pathname)) {
    return { user: null }
  }
  // prefix match?
  if (publicPrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    console.log('→ skipping auth for public prefix:', pathname)
    return { user: null }
  }

  // 2️⃣ Grab token cookie
  const tokenCookie = req.cookies.get('vendortoken');
  if (!tokenCookie?.value) {
    // not logged in → send to /agency login
    return { response: NextResponse.redirect(new URL('/agency', origin)) };
  }

  // 3️⃣ Verify & load user
  try {
    const { userId } = jwt.verify(tokenCookie.value, process.env.JWT_SECRET);
    const user = await User.findById(userId).select('-password');
    if (!user) {
      // token ok but no user → back to login
      return { response: NextResponse.redirect(new URL('/agency', origin)) };
    }

    // success → return the user for the next phase
    return { user };
  } catch (err) {
    console.error('Auth error:', err);
    return { response: NextResponse.redirect(new URL('/agency', origin)) };
  }
}
