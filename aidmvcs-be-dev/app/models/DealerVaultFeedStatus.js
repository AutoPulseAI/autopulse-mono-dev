// One document per DealerVault store and file type (24 Nov 2026): the newest file seen and what happened to it, kept by
// the importer (lib/dealervault/feedStatus.js). Admin > DMS feed reads the store list and "late" from here instead of
// listing the whole S3 bucket, so it stays fast with thousands of stores.
import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  dvDealerId: { type: String, required: true },
  fileType: { type: String, required: true },
  dealer_id: { type: String, default: null }, // the linked AutoPulse dealer when the file was seen
  last_file: { type: String, default: null },
  last_stamp: { type: String, default: null }, // YYYYMMDDhhmm from the file name (the DMS file time, UTC)
  last_state: { type: String, enum: ['queued', 'held'], default: 'queued' },
  first_stamp: { type: String, default: null },
  stamps: { type: [String], default: [] }, // the last 30 days of file times, newest last (cadence and gaps)
}, { timestamps: true, collection: 'dealervault_feed_status' });

schema.index({ dvDealerId: 1, fileType: 1 }, { unique: true });
schema.index({ dealer_id: 1 });

export default mongoose.models.DealerVaultFeedStatus || mongoose.model('DealerVaultFeedStatus', schema);
