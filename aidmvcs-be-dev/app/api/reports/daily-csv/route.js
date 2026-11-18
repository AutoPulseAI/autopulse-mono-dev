// GET /api/reports/daily-csv?d=<dealer id>&date=YYYY-MM-DD&e=<expiry>&s=<signature> - the daily email's numbers as a
// CSV (SOW F2 "secure download link"; app/lib/reports/dailyCsv.js). The signed link in the email is the permission:
// counts only, from the saved snapshot the email was made from. 403 bad / expired link · 404 no snapshot.
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import { findSnapshot } from '@lib/reports/dailySnapshot';
import { snapshotCsv, validCsvLink } from '@lib/reports/dailyCsv';

export const runtime = 'nodejs';

export async function GET(req) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (!validCsvLink(p)) return new Response('This link is not valid or has expired.', { status: 403 });
  await dbConnect();
  const snapshot = await findSnapshot(p.d, p.date);
  if (!snapshot) return new Response('No report for that day.', { status: 404 });
  const dealer = await User.findById(p.d).select('name dealer_account_information.store_name').lean();
  const store = dealer?.dealer_account_information?.store_name || dealer?.name || '';
  return new Response(snapshotCsv(snapshot, store), { headers: { 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="daily-report-${p.date}.csv"`, 'Cache-Control': 'private, no-store' } });
}
