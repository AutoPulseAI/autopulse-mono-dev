// Car Finder watch (SOW v6 Deliverable J: "Car Finder: capture desired vehicle criteria and initiate search follow-up").
// After each inventory import, every visit left UNSOLD - Car Finder in the last CAR_FINDER_DAYS is checked against the
// cars that came in since its outcome: same make, and the model / year when the visit names them (the year +/- 1). Each
// new match is kept on the visit (Desk Log: "Car found"), noted on the lead for the salesperson and the AI (a note
// the AI reads, so its next message can mention it - the AI decides what to say), and the managers are alerted once
// per visit and run. Never the same car twice for one visit. All dealers.
import mongoose from 'mongoose';
import { notifyManagers } from '../ai/managerAlerts.js';

export const CAR_FINDER_DAYS = 90;
const norm = (s) => String(s || '').trim().toLowerCase();

export async function checkCarFinder({ db = mongoose.connection.db, now = new Date(), alert = notifyManagers } = {}) {
  const since = new Date(now.getTime() - CAR_FINDER_DAYS * 864e5);
  const visits = await db.collection('desklogentries').find({ outcome: 'UNSOLD', unsold_reason: 'Car Finder',
    outcome_at: { $gte: since }, 'vehicle.make': { $nin: [null, ''] } }).toArray();
  const summary = { visits: visits.length, matches: 0 };
  for (const v of visits) {
    const want = v.vehicle || {};
    const q = { dealerId: String(v.dealer_id), removedAt: null, createdAt: { $gte: v.outcome_at || since },
      make: new RegExp(`^${String(want.make).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
    const cars = await db.collection('vehicles').find(q, { projection: { vin: 1, VIN: 1, year: 1, make: 1, model: 1,
      trim: 1, stockNumber: 1, price: 1, internetReduced: 1, internetSpecial: 1 } }).limit(200).toArray();
    const seen = new Set((v.car_finder_matches || []).map((m) => m.vin));
    const fresh = cars.filter((c) => {
      const vin = String(c.vin || c.VIN || '');
      if (!vin || seen.has(vin)) return false;
      if (want.model && !norm(c.model).includes(norm(want.model))) return false;
      if (want.year && c.year && Math.abs(Number(c.year) - Number(want.year)) > 1) return false;
      return true;
    }).slice(0, 5);
    if (!fresh.length) continue;
    const matches = fresh.map((c) => ({ vin: String(c.vin || c.VIN), stock_number: c.stockNumber || null,
      vehicle: [c.year, c.make, c.model, c.trim].filter(Boolean).join(' '),
      price: Number(c.internetReduced || c.internetSpecial || c.price) || null, found_at: now }));
    await db.collection('desklogentries').updateOne({ _id: v._id }, { $push: { car_finder_matches: { $each: matches },
      history: { field: 'car_finder_match', from: null, to: matches.map((m) => m.vehicle).join('; '), at: now, by_name: 'Car Finder' } } });
    const list = matches.map((m) => `${m.vehicle}${m.stock_number ? ` (stock #${m.stock_number})` : ''}, VIN ${m.vin}`).join('; ');
    await db.collection('emails').insertOne({ sender: 'Car Finder', recipient: 'staff', subject: 'Lead Note',
      mail_content: `Car Finder: a vehicle matching what this customer wanted just arrived in stock - ${list}.`,
      dealer_id: String(v.dealer_id), lead_id: v.lead_id, status: 'sent', communication_type: 'note', is_note: true,
      internal_use: false, message_id: `note_car_finder_${v._id}_${now.getTime()}`, timestamp: now, date: now });
    await alert({ dealerId: String(v.dealer_id), leadId: String(v.lead_id), title: 'Car Finder: a matching car arrived',
      detail: list }).catch(() => {});
    summary.matches += matches.length;
  }
  return summary;
}
