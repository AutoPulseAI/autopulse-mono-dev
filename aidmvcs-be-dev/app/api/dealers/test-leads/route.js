import dbConnect from "@lib/mongodb";
import Lead from "@models/Lead";
import { requireDealerOrSuperAdmin } from '@lib/apiGuard';

export async function GET(req) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(req.url);
    const dealerId = searchParams.get("dealer_id");
    // Signed-in users only, for their own dealership (super admin: any; no dealer_id: super admin only).
    const access = await requireDealerOrSuperAdmin(req, dealerId);
    if (access.response) return access.response;
    
    if (!dealerId) {
      return new Response(JSON.stringify({ message: "Dealer ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get all leads for the dealer (no date filtering)
    const allLeads = await Lead.find({ dealer_id: dealerId }).limit(5);
    
    // Get total count
    const totalCount = await Lead.countDocuments({ dealer_id: dealerId });
    
    // Get unique status values
    const uniqueStatuses = await Lead.distinct('fe_lead_status', { dealer_id: dealerId });
    const uniqueRegularStatuses = await Lead.distinct('status', { dealer_id: dealerId });
    
    // Sample lead structure
    const sampleLead = allLeads.length > 0 ? allLeads[0] : null;
    
    return new Response(JSON.stringify({
      dealerId,
      totalLeads: totalCount,
      sampleLeads: allLeads.length,
      uniqueFeLeadStatuses: uniqueStatuses,
      uniqueRegularStatuses: uniqueRegularStatuses,
      sampleLeadStructure: sampleLead,
      allLeads: allLeads
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Test leads error:", error);
    return new Response(JSON.stringify({ 
      message: "Failed to test leads",
      error: error.message 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
