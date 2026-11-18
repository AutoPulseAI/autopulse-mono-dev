  import mongoose from 'mongoose';

  const leadSchema = new mongoose.Schema(
    {
      // Specific fields for lead creation
      name: { type: String }, // Optional: You can make this required if needed
      email: { type: String }, // Optional: You can make this required if needed
      phone: { type: String }, // Optional: You can make this required if needed
      source: { type: String, default: 'email' }, // Default value for source
      // What the lead provider says beyond its own name, e.g. CarGurus "Reengagement" (ADF provider name / service;
      // app/lib/adfLeadParser.js adfSubSource). Null = no sub-source. For the source / sub-source report.
      sub_source: { type: String, default: null },
      // The reference CRM's "Active / Not in Market" (SOW B3; 13 Nov 2026 meeting 10.11): staff mark an opportunity
      // not in the market any more. A flag for staff and lists only - it does not change the AI's follow-ups or the
      // status. Missing = active.
      in_market: { type: Boolean, default: undefined },
      in_market_at: { type: Date, default: undefined },
      // Vehicles of interest on this opportunity besides its main vehicle (SOW B3 "Vehicles of Interest"; Deliverable
      // I: each opportunity keeps its own vehicle of interest). Added by staff, usually from the dealer's inventory.
      vehicles_of_interest: { type: [new mongoose.Schema({ year: String, make: String, model: String, trim: String,
        vin: String, stock: String, added_by_name: String, at: { type: Date, default: Date.now } })], default: undefined },
      // The dealer's campaign this lead came from (app/lib/leadCampaign.js): set when the lead arrives and its
      // sub-source / lead source is a campaign's tracking code, or by staff on the lead card. Null = none.
      campaign: { type: String, default: null },
      campaign_set_by: { type: String, default: undefined }, // 'code' (on arrival) | 'staff'
      // Betsy, 27 Oct 2026 meeting: how the lead came in - internet, phone-up or walk-in (app/lib/leadContactType.js).
      contact_type: { type: String, enum: ['internet', 'phone', 'walk_in', null], default: null },
      // Betsy, 14 Nov 2026: the lead's department (app/lib/departments.js). Missing = sales.
      department: { type: String, enum: ['sales', 'service', 'parts', null], default: undefined },
      // Who set it last (app/lib/departmentRouting.js): 'source' (on arrival), 'ai', 'system' (an appointment, the
      // Desk Log) or 'staff' (by hand - automatic moves then leave the lead alone).
      department_set_by: { type: String, default: undefined },
      department_at: { type: Date, default: undefined },

      dealer_id:{ type: String },
      customer_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        default: null,
      },
      statusChangedAt:{type:Date},

      // Set by scripts/backfill-customers-for-orphaned-leads.js on every
      // orphaned Lead it touches, so a given run's leads can be found again
      // later (e.g. `migration_20260829_213045`).
      migration_batch: { type: String, default: null },

      // Staff assignment field
      assigned_to: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        default: null 
      },

      // Store any additional data dynamically
      data: { type: mongoose.Schema.Types.Mixed },
    },
    { strict: false, timestamps: true } // Automatically add createdAt and updatedAt fields
  );

  leadSchema.index({ dealer_id: 1, customer_id: 1 });
  // One department's leads, newest first (the Dashboard / reports per department; 17 Nov 2026).
  leadSchema.index({ dealer_id: 1, department: 1, createdAt: -1 });
  // A new lead takes its department from its source (app/lib/departmentRouting.js): a service / parts source is that
  // department from the start; anything else is Sales - stored, so every lead carries its tag.
  leadSchema.pre('save', async function departmentOnArrival() {
    if (!this.isNew || this.get('department')) return;
    const { departmentFromSource } = await import('../lib/departmentRouting.js');
    // Every lead is tagged (the user, 17 Nov 2026): its source's department, else Sales.
    const dept = departmentFromSource(this.toObject());
    this.set('department', dept || 'sales');
    this.set('department_set_by', dept ? 'source' : 'default');
    this.set('department_at', new Date());
  });
  // A new lead whose sub-source / lead source is one of the dealer's campaign tracking codes gets that campaign
  // (app/lib/leadCampaign.js). A lookup problem never stops the lead being saved.
  leadSchema.pre('save', async function campaignOnArrival() {
    if (!this.isNew || this.get('campaign') || !this.get('dealer_id')) return;
    try {
      const { campaignForLead } = await import('../lib/leadCampaign.js');
      const name = await campaignForLead(this.get('dealer_id'), this.toObject());
      if (name) { this.set('campaign', name); this.set('campaign_set_by', 'code'); }
    } catch { /* the lead is saved without a campaign */ }
  });
  leadSchema.pre('save', function rememberNew() { this.$locals.wasNew = this.isNew; });
  // A new Service / Parts lead: that department's staff are emailed (17 Nov 2026, the user: "if a new service lead
  // came in, we need to email the service team"). Sales leads are not (that is today's flow).
  leadSchema.post('save', function newDepartmentLead(doc) {
    if (!doc?.$locals?.wasNew || !['service', 'parts'].includes(doc.department)) return;
    doc.$locals.wasNew = false;
    import('../lib/departments.js').then((m) => m.notifyDepartment({ dealerId: doc.dealer_id, lead: doc.toObject(),
      department: doc.department, arrived: true })).catch(() => null);
  });

  const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

  export default Lead;
