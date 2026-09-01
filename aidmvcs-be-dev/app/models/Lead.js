  import mongoose from 'mongoose';

  const leadSchema = new mongoose.Schema(
    {
      // Specific fields for lead creation
      name: { type: String }, // Optional: You can make this required if needed
      email: { type: String }, // Optional: You can make this required if needed
      phone: { type: String }, // Optional: You can make this required if needed
      source: { type: String, default: 'email' }, // Default value for source

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

  const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

  export default Lead;
