import { NextResponse } from "next/server";
import mongoose from "mongoose";
import EmailAccount from "@models/EmailAccount";
import { addHestiaEmailAccount } from "@utils/hestiaCloudflare";
import { requireDealerAccess, requireUser, denied } from "@lib/apiGuard";

// Signed-in users only, for their own dealership's accounts (an agency: its dealers' and its own; super admin: all).
// These methods used to have no sign-in check (GET returned any dealer's accounts).
const accountAccess = (req, ownerId) => requireDealerAccess(req, ownerId);

// PUT/DELETE name an account by id: allowed when the caller may access the account's dealer.
async function existingAccountAccess(req, id) {
  const signedIn = await requireUser(req);
  if (signedIn.response) return signedIn;
  const account = mongoose.isValidObjectId(id) ? await EmailAccount.findById(id).select("dealer_id") : null;
  if (!account) return { response: NextResponse.json({ message: "Email account not found" }, { status: 404 }) };
  const access = await accountAccess(req, account.dealer_id);
  return access.response ? { response: denied(access.response.status) } : access;
}

// ✅ GET: Fetch all email accounts
export async function GET(req) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    
    const { searchParams } = new URL(req.url);
    const dealer_id = searchParams.get("dealer_id");
      const access = await accountAccess(req, dealer_id);
      if (access.response) return access.response;
      const emailAccounts = await EmailAccount.find({ dealer_id });
      return NextResponse.json(emailAccounts);
  } catch (err) {
      return NextResponse.json({ message: err.message }, { status: 500 });
  }
}

// ✅ POST: Create a new email account
export async function POST(req) {
    const { dealer_id, account_name, event_type, email_address, email_password, active, domain } = await req.json();

    try {
        const access = await accountAccess(req, dealer_id);
        if (access.response) return access.response;
        // Check if the email address already exists in MongoDB
        const existingAccount = await EmailAccount.findOne({ email_address });
        if (existingAccount) {
            return NextResponse.json({ message: "Email address already exists" }, { status: 400 });
        }

        // Add email account to HestiaCP
        const hestiaResponse = await addHestiaEmailAccount(email_address, email_password, domain);
        if (!hestiaResponse.success) {
            return NextResponse.json({ message: hestiaResponse.error }, { status: 400 });
        }

        // Save email account in MongoDB
        const newAccount = new EmailAccount({
            dealer_id, // Assuming user is available in the context
            account_name,
            event_type,
            email_address,
            email_password,
            active,
        });
        await newAccount.save();

        return NextResponse.json({ message: "Email account created successfully" });
    } catch (err) {
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}

// ✅ PUT: Update an existing email account
export async function PUT(req) {
    const { id, account_name, event_type, email_address, email_password, active } = await req.json();

    try {
        const access = await existingAccountAccess(req, id);
        if (access.response) return access.response;
        // Update email account in MongoDB
        const updatedAccount = await EmailAccount.findByIdAndUpdate(
            id,
            { account_name, event_type, email_address, email_password, active },
            { new: true }
        );

        if (!updatedAccount) {
            return NextResponse.json({ message: "Email account not found" }, { status: 404 });
        }

        return NextResponse.json({ message: "Email account updated successfully" });
    } catch (err) {
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}

// ✅ DELETE: Delete an email account
export async function DELETE(req) {
    const { id } = await req.json();

    try {
        const access = await existingAccountAccess(req, id);
        if (access.response) return access.response;
        // Find the email account in MongoDB
        const emailAccount = await EmailAccount.findById(id);
        if (!emailAccount) {
            return NextResponse.json({ message: "Email account not found" }, { status: 404 });
        }

        // Delete the email account from HestiaCP
        const hestiaResponse = await deleteHestiaEmailAccount(emailAccount.email_address, emailAccount.domain);
        if (!hestiaResponse.success) {
            return NextResponse.json({ message: hestiaResponse.error }, { status: 400 });
        }

        // Delete the email account from MongoDB
        await EmailAccount.findByIdAndDelete(id);

        return NextResponse.json({ message: "Email account deleted successfully" });
    } catch (err) {
        return NextResponse.json({ message: err.message }, { status: 500 });
    }
}

// Function to delete email account in HestiaCP
const deleteHestiaEmailAccount = async (email, domain) => {
    const HESTIA_CP_API_URL = process.env.HESTIA_CP_API_URL;
    const HESTIA_CP_API_KEY = process.env.HESTIA_CP_API_KEY;
    const HESTIA_CP_USER = process.env.HESTIA_CP_USER;

    const payload = new URLSearchParams({
        hash: HESTIA_CP_API_KEY,
        user: HESTIA_CP_USER,
        cmd: "v-delete-mail-account",
        arg1: HESTIA_CP_USER, // HestiaCP username
        arg2: domain, // Domain name
        arg3: email.split("@")[0], // Email username (e.g., rahul from rahul@ravi.com)
    });

    const response = await fetch(`${HESTIA_CP_API_URL}/api/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload,
    });

    const rawResponse = await response.text();
    if (rawResponse === "OK") {
        return { success: true };
    } else {
        return { success: false, error: rawResponse };
    }
};