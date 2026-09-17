import mongoose from 'mongoose';

const wholeNumberValidator = { validator: value => value == null || Number.isInteger(value), message: '{PATH} must be a whole number' };

const TRADE_IN_STATUSES = [
  'open',
  'closed',
  'appointment booked',
  'Awaiting Customer response',
  'contacted',
];

const tradeInSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },

    // Manual entry enforces VIN in the API/form; ADF may have only year/make/model.
    vin: { type: String, default: null, trim: true, uppercase: true },
    year: { type: Number, min: 1900, validate: wholeNumberValidator },
    make: { type: String, trim: true },
    model: { type: String, trim: true },
    trim: { type: String, trim: true },
    miles: { type: Number, min: 0, validate: wholeNumberValidator },
    exterior_color: { type: String, trim: true },
    interior_color: { type: String, trim: true },
    trade_offer_amount: { type: Number, min: 0 },
    trade_acv_amount: { type: Number, min: 0 },
    trade_stock_number: { type: String, trim: true },
    condition: { type: String, default: null, trim: true },
    notes: { type: String, default: null, trim: true },
    lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    raw_adf_payload_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RawAdfPayload', default: null },
    source_message_id: { type: String, default: null },
    source_candidate_key: { type: String, default: null },

    status: { type: String, enum: TRADE_IN_STATUSES, required: true, default: 'open' },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

tradeInSchema.index({ dealer_id: 1, customer_id: 1 });

tradeInSchema.pre('validate', function () {
  if (!this.vin && !this.raw_adf_payload_id) this.invalidate('vin', 'VIN is required for manual trades');
  if (this.raw_adf_payload_id && !this.vin && !(this.year && this.make && this.model)) {
    this.invalidate('vin', 'ADF trades need a VIN or year, make and model');
  }
});

export const TRADE_SOURCE_INDEX = {
  key: { dealer_id: 1, raw_adf_payload_id: 1, source_candidate_key: 1 },
  options: {
    name: 'adf_trade_candidate_unique', unique: true,
    partialFilterExpression: { raw_adf_payload_id: { $type: 'objectId' }, source_candidate_key: { $type: 'string' } },
  },
};
// Deploy explicitly before enabling enrichment. No changes to manual trade uniqueness.
tradeInSchema.index(TRADE_SOURCE_INDEX.key, { ...TRADE_SOURCE_INDEX.options, _autoIndex: false });

export const TRADE_IN_STATUS_VALUES = TRADE_IN_STATUSES;

const TradeIn = mongoose.models.TradeIn || mongoose.model('TradeIn', tradeInSchema);

export default TradeIn;
