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
  // department from the start; anything else is Sales (no department stored).
  leadSchema.pre('save', async function departmentOnArrival() {
    if (!this.isNew || this.get('department')) return;
    const { departmentFromSource } = await import('../lib/departmentRouting.js');
    const dept = departmentFromSource(this.toObject());
    if (dept) { this.set('department', dept); this.set('department_set_by', 'source'); this.set('department_at', new Date()); }
  });

  const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

  export default Lead;
