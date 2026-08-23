// app/api/packages/[id]/route.js
import { NextResponse } from "next/server";
import EmailAccount from "@models/EmailAccount";
import { getServerSession } from "next-auth";
import dbConnect from "@lib/mongodb";
import { authOptions } from "@lib/auth";
import { addHestiaEmailAccount } from "@utils/hestiaCloudflare";

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
export async function DELETE(request, { params }) {
  
    await dbConnect();
    
    // Get the session
  

    const { id } = await params;
  
    try {
        // Find the email account in MongoDB
        const emailAccount = await EmailAccount.findById(id);
        if (!emailAccount) {
            return NextResponse.json({ message: "Email account not found" }, { status: 404 });
        }
        try{
        // Delete the email account from HestiaCP
            const hestiaResponse = await deleteHestiaEmailAccount(emailAccount.email_address, emailAccount.domain);
            if (!hestiaResponse.success) {
                //return NextResponse.json({ message: hestiaResponse.error }, { status: 400 });
            }
        }catch (err) {
            console.log('hestia error');
        }

        // Delete the email account from MongoDB
        await EmailAccount.findByIdAndDelete(id);

        return NextResponse.json({ message: "Email account deleted successfully" });
    } catch (err) {
        return NextResponse.json({ message: err.message }, { status: 500 });
    };

    

    

 
}