import mongoose from "mongoose";

const EmailAccountSchema = new mongoose.Schema(
  {
    dealer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // The dealer who owns this email account
    account_name: { type: String, required: true },
    event_type: { type: String, required: true }, // Sales, Service, etc.
    account_type: { type: String }, // POP3 or IMAP
    mail_account: { type: String,  }, // Example: Gmail, Outlook, etc.
    email_address: { type: String, required: true, unique: true },
    pop3_server: { type: String, }, // Incoming Mail Server
   
    email_password: { type: String, required: true }, // Encrypted Password
    active: { type: Boolean, default: true }, // Account active status
    admin_email: { type: String}, // Admin email for logs
    
  },
  { timestamps: true,strict: false }
);

export default mongoose.models.EmailAccount || mongoose.model("EmailAccount", EmailAccountSchema);
