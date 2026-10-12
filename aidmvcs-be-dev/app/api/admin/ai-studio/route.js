// AI Studio (client, 13 Oct 2026) - super admin only.
//   GET  /api/admin/ai-studio            every item (seeds the built-in settings as version 1 the first time)
//   POST /api/admin/ai-studio            { type, name, content }  a new item, saved as a draft
import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { CONDITIONS, OUTCOMES, PLACEHOLDERS, TYPES, createItem, listItems, requireStudioAdmin } from '@lib/ai/aiStudio';
import { studioUser } from './_user';

export async function GET(request) {
  const auth = requireStudioAdmin(request);
  if (auth.error) return auth.error;
  await dbConnect();
  return NextResponse.json({ items: await listItems(), types: TYPES, placeholders: PLACEHOLDERS, conditions: CONDITIONS,
    outcomes: OUTCOMES });
}

export async function POST(request) {
  const auth = requireStudioAdmin(request);
  if (auth.error) return auth.error;
  await dbConnect();
  const body = await request.json().catch(() => ({}));
  const result = await createItem(body, { by: await studioUser(auth.decoded) });
  return NextResponse.json(result, { status: result.status || 200 });
}
