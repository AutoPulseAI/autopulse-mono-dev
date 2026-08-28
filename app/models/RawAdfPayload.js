import mongoose from 'mongoose';

const rawAdfPayloadSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    message_id: { type: String, required: true },
    source: { type: String, enum: ['body', 'attachment'], required: true },
    attachment_filename: { type: String, default: null },
    raw_xml: { type: String, required: true },
  },
  { timestamps: true }
);

// Unique on the exact tuple callers upsert on (see saveRawAdfPayload in
// app/worker/emailWorker.js) - not just {dealer_id, message_id}, since a single
// message can have one "body" row plus one "attachment" row per ADF-looking
// attachment. Backs the upsert atomically against concurrent workers.
rawAdfPayloadSchema.index(
  { dealer_id: 1, message_id: 1, source: 1, attachment_filename: 1 },
  { unique: true }
);

const RawAdfPayload =
  mongoose.models.RawAdfPayload || mongoose.model('RawAdfPayload', rawAdfPayloadSchema);

export default RawAdfPayload;
