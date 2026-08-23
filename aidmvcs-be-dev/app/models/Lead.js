  import mongoose from 'mongoose';

  const leadSchema = new mongoose.Schema(
    {
      // Specific fields for lead creation
      name: { type: String }, // Optional: You can make this required if needed
      email: { type: String }, // Optional: You can make this required if needed
      phone: { type: String }, // Optional: You can make this required if needed
      source: { type: String, default: 'email' }, // Default value for source

      dealer_id:{ type: String },
      statusChangedAt:{type:Date},
      
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

  const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

  export default Lead;