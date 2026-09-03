// app/agency/middleware/dealerAuth.js
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import User from '@models/User';
import dbConnect from '@lib/mongodb';

export async function dealerauthMiddleware(req) {
  await dbConnect()

  const { pathname, origin } = req.nextUrl
  //console.log('▶ dealerAuthMiddleware sees:', pathname)

  // public pages (exact) or true prefixes (folder routes)
  const publicExact = ['/dealer']
  const publicPrefixes = [
    '/dealer/register',
    '/dealer/forgot-password',    // note: use "forgot" if that's your folder
    '/dealer/reset',
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

  // grab the cookie
  const cookie = req.cookies.get('dealertoken')
  if (!cookie?.value) {
    console.log('No dealertoken, redirect → /dealer')
    return { response: NextResponse.redirect(new URL('/dealer', origin)) }
  }

  // verify
  try {
    const { userId } = jwt.verify(cookie.value, process.env.JWT_SECRET)
    const user = await User.findById(userId).select('-password')
    if (!user) {
      console.log('Token ok but user not found → redirect')
      return { response: NextResponse.redirect(new URL('/dealer', origin)) }
    }
    return { user }
  } catch (err) {
    console.error('Auth error:', err)
    return { response: NextResponse.redirect(new URL('/dealer', origin)) }
  }
}
