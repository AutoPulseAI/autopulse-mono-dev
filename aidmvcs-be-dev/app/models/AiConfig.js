// AI Studio (client, 13 Oct 2026): every agent, bucket, lead source, cadence, message, script, status rule and prompt
// the AI uses, as an item with a full version history. A save is a new version (never an edit of an old one); a draft
// reaches customers only once published; "revert" publishes a copy of an older version. Version 1 of every item is the
// AI's built-in setting (app/lib/ai/aiStudioDefaults.json, exported from the AI's code).
import mongoose from 'mongoose';

const aiConfigItemSchema = new mongoose.Schema({
  type: { type: String, required: true }, // agents | buckets | sources | cadences | messages | scripts | status_rules | prompts
  key: { type: String, required: true },
  name: { type: String, required: true },
  // null: every dealer (the default). A dealer id: that dealer's own version (later).
  dealer_id: { type: String, default: null },
  // Legal / safety items (the compliance rules, the reader prompt) can be viewed but never changed.
  locked: { type: Boolean, default: false },
  published_version: { type: Number, default: 1 },
  draft_version: { type: Number, default: null },
  latest_version: { type: Number, default: 1 },
  // Which built-in revision this item's version 1 came from (app/lib/ai/aiStudioDefaults.json "revision").
  defaults_revision: { type: Number, default: 1 },
  deleted: { type: Boolean, default: false },
}, { timestamps: true });
aiConfigItemSchema.index({ type: 1, key: 1, dealer_id: 1 }, { unique: true });

const aiConfigVersionSchema = new mongoose.Schema({
  item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AiConfigItem', required: true },
  version: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  content: { type: mongoose.Schema.Types.Mixed, required: true },
  note: { type: String, default: null },
  created_by: { type: String, default: null },
  created_by_name: { type: String, default: null },
  published_at: { type: Date, default: null },
  published_by_name: { type: String, default: null },
  // Set on a version made by "revert": the version it copies.
  reverted_from: { type: Number, default: null },
}, { timestamps: true });
aiConfigVersionSchema.index({ item_id: 1, version: -1 }, { unique: true });

export const AiConfigItem = mongoose.models.AiConfigItem
  || mongoose.model('AiConfigItem', aiConfigItemSchema, 'ai_config_items');
export const AiConfigVersion = mongoose.models.AiConfigVersion
  || mongoose.model('AiConfigVersion', aiConfigVersionSchema, 'ai_config_versions');
