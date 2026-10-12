// AI Studio, one item - super admin only.
//   GET    .../[id]                                  the item and every version
//   PUT    .../[id]   { content, note }              save a new draft
//   POST   .../[id]   { action: "publish", version } | { action: "revert", version } | { action: "reset" }
//   DELETE .../[id]                                  remove an item the super admin created (built-in ones can't be)
import { NextResponse } from 'next/server';
import dbConnect from '@lib/mongodb';
import { getItem, publish, removeItem, requireStudioAdmin, resetToDefault, revert, saveDraft } from '@lib/ai/aiStudio';
import { studioUser } from '../_user';

const reply = (result) => NextResponse.json(result, { status: result.status || 200 });

export async function GET(request, { params }) {
  const auth = requireStudioAdmin(request);
  if (auth.error) return auth.error;
  await dbConnect();
  const { id } = await params;
  const item = await getItem(id).catch(() => null);
  return item ? NextResponse.json(item) : NextResponse.json({ error: 'Not found.' }, { status: 404 });
}

export async function PUT(request, { params }) {
  const auth = requireStudioAdmin(request);
  if (auth.error) return auth.error;
  await dbConnect();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return reply(await saveDraft(id, body.content, { note: body.note, by: await studioUser(auth.decoded) }));
}

export async function POST(request, { params }) {
  const auth = requireStudioAdmin(request);
  if (auth.error) return auth.error;
  await dbConnect();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const by = await studioUser(auth.decoded);
  if (body.action === 'publish') return reply(await publish(id, body.version, { by }));
  if (body.action === 'revert') return reply(await revert(id, body.version, { by }));
  if (body.action === 'reset') return reply(await resetToDefault(id, { by }));
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

export async function DELETE(request, { params }) {
  const auth = requireStudioAdmin(request);
  if (auth.error) return auth.error;
  await dbConnect();
  const { id } = await params;
  return reply(await removeItem(id));
}
