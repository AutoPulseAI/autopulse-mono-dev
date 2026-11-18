import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import dbConnect from "@lib/mongodb";
import Customer from "@models/Customer";
import Lead from "@models/Lead";
import User from "@models/User";
import { isAuthorizedForDealer } from "@lib/customerListing";
import { logActivity } from "@lib/activityLog";

function jsonError(message, status) {
  return NextResponse.json({ message }, { status });
}

async function loadAuthenticatedUser(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !/^Bearer\s+\S+$/.test(authHeader)) return null;

  const token = authHeader.replace(/^Bearer\s+/, "");
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded?.userId || !mongoose.isValidObjectId(decoded.userId)) return null;

  return User.findById(decoded.userId).select("_id name type parent_id vendor_id");
}

export async function GET(req, { params }) {
  try {
    await dbConnect();
    const currentUser = await loadAuthenticatedUser(req);
    if (!currentUser) return jsonError("Unauthorized", 401);

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return jsonError("Invalid customer id", 400);

    const url = new URL(req.url);
    const dealerId = url.searchParams.get("dealer_id")?.trim();
    if (!dealerId) return jsonError("dealer_id is required", 400);

    if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
      return jsonError("Forbidden", 403);
    }

    const customer = await Customer.findOne({ _id: id, dealer_id: dealerId }).lean();
    if (!customer) return jsonError("Customer not found", 404);

    const leadCount = await Lead.countDocuments({ customer_id: customer._id });

    return NextResponse.json({ data: { ...customer, lead_count: leadCount } });
  } catch (error) {
    console.error("Customer detail fetch failed:", error);
    return jsonError("Internal server error", 500);
  }
}

// Intentionally never accepts emails/phones here - each entry carries a
// first_seen_lead_id back-reference to the Lead that introduced it, so
// editing/removing one from this route would desync that Lead.
export async function PUT(req, { params }) {
  try {
    await dbConnect();
    const currentUser = await loadAuthenticatedUser(req);
    if (!currentUser) return jsonError("Unauthorized", 401);

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return jsonError("Invalid customer id", 400);

    const body = await req.json();
    const dealerId = body.dealer_id?.toString().trim();
    if (!dealerId) return jsonError("dealer_id is required", 400);

    if (!(await isAuthorizedForDealer(currentUser, dealerId))) {
      return jsonError("Forbidden", 403);
    }

    const existingCustomer = await Customer.findOne({ _id: id, dealer_id: dealerId })
      .select("assigned_to name followup_preference preferred_communication_mode user_language details")
      .lean();
    if (!existingCustomer) return jsonError("Customer not found", 404);

    const updates = {};
    if (body.name !== undefined) {
      updates.name = body.name?.toString().replace(/\s+/g, " ").trim().slice(0, 120) || "";
      if (!updates.name) return jsonError("The customer needs a name", 400);
    }
    if (body.followup_preference !== undefined) updates.followup_preference = body.followup_preference;
    if (body.user_language !== undefined) updates.user_language = body.user_language;
    if (body.preferred_communication_mode !== undefined) {
      updates.preferred_communication_mode = body.preferred_communication_mode;
      updates.preferred_communication_mode_selected = true;
    }

    // Staff-typed details (13 Nov 2026 meeting 10.14): { details: { <field>: text } }, each one on its own.
    const DETAIL_FIELDS = { title: 20, nickname: 60, gender: 20, marital_status: 20, birthday: 10, anniversary: 10,
      spouse_name: 120, note: 1000 };
    const detailChanges = [];
    const unsets = {};
    if (body.details && typeof body.details === "object") {
      for (const [f, raw] of Object.entries(body.details)) {
        if (!DETAIL_FIELDS[f]) return jsonError(`${f} cannot be changed here`, 400);
        const v = String(raw ?? "").replace(f === "note" ? /[ \t]+/g : /\s+/g, " ").trim().slice(0, DETAIL_FIELDS[f]);
        if (["birthday", "anniversary"].includes(f) && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return jsonError(`The ${f} is not a date`, 422);
        if (v) updates[`details.${f}`] = v; else unsets[`details.${f}`] = "";
        detailChanges.push({ f, from: existingCustomer.details?.[f] ?? null, to: v || null });
      }
    }

    // TODO(customer-assignment-permission): unlike the leads dropdown (gated
    // by "Assign Leads" in the UI, see CustomerHeader.js), this route accepts
    // an assignment from any authenticated dealer-scoped user - there's no
    // permission check on the assignment capability itself yet. Logged below
    // so an assignment made by someone who shouldn't have been able to is at
    // least auditable until that permission check exists.
    let assignedTo;
    let assigneeUser = null;
    const isAssigning = body.assigned_to !== undefined;
    if (isAssigning) {
      assignedTo = body.assigned_to?.toString().trim() || null;
      if (assignedTo) {
        if (!mongoose.isValidObjectId(assignedTo)) {
          return jsonError("assigned_to is invalid", 400);
        }
        // Must be a real staff user belonging to *this* dealer - not just
        // any valid ObjectId, which would otherwise let a customer (and its
        // leads) be assigned to a nonexistent user, an admin/vendor account,
        // or another dealer's staff.
        assigneeUser = await User.findOne({ _id: assignedTo, parent_id: dealerId, type: "dealer" })
          .select("_id name");
        if (!assigneeUser) {
          return jsonError("assigned_to must be a staff member of this dealer", 400);
        }
      }
      updates.assigned_to = assignedTo;
    }

    const customer = await Customer.findOneAndUpdate(
      { _id: id, dealer_id: dealerId },
      { ...(Object.keys(updates).length ? { $set: updates } : {}), ...(Object.keys(unsets).length ? { $unset: unsets } : {}) },
      { new: true }
    ).lean();
    if (!customer) return jsonError("Customer not found", 404);

    // Edited on the profile (17 Nov 2026, Betsy: "we should be able to make changes to the customer profile"): every
    // change on the customer's timeline; a new name also goes on the customer's leads that had the old name (or
    // none), so the lead pages, lists and messages use it too.
    const fieldNames = { name: "name", followup_preference: "follow-up preference",
      preferred_communication_mode: "preferred contact", user_language: "language" };
    for (const [f, label] of Object.entries(fieldNames)) {
      if (updates[f] === undefined || String(existingCustomer[f] ?? "") === String(updates[f] ?? "")) continue;
      await logActivity({ dealer_id: dealerId, customer_id: id, actor_type: "staff", actor_id: currentUser._id,
        actor_name: currentUser.name || null, action: "customer_edited", from: existingCustomer[f] ?? null,
        to: updates[f] ?? null, detail: label });
    }
    const DETAIL_LABELS = { title: "title", nickname: "nickname", gender: "gender", marital_status: "marital status",
      birthday: "birthday", anniversary: "anniversary", spouse_name: "spouse", note: "customer note" };
    for (const c of detailChanges) {
      if (String(c.from ?? "") === String(c.to ?? "")) continue;
      await logActivity({ dealer_id: dealerId, customer_id: id, actor_type: "staff", actor_id: currentUser._id,
        actor_name: currentUser.name || null, action: "customer_edited", from: c.f === "note" ? null : c.from,
        to: c.f === "note" ? (c.to ? "a new note" : null) : c.to, detail: DETAIL_LABELS[c.f] });
    }
    if (updates.name && updates.name !== (existingCustomer.name || "")) {
      const oldName = (existingCustomer.name || "").trim();
      const sameName = oldName ? new RegExp(`^\\s*${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i") : null;
      await Lead.updateMany({ customer_id: id, dealer_id: dealerId,
        $or: [{ name: { $in: [null, ""] } }, { name: { $exists: false } }, ...(sameName ? [{ name: sameName }] : [])] },
      { $set: { name: updates.name, updatedAt: new Date() } });
    }

    const previousAssignedTo = existingCustomer.assigned_to ? String(existingCustomer.assigned_to) : null;
    const hasAssignmentChanged = isAssigning && previousAssignedTo !== (assignedTo || null);

    // Assigning the customer to a user carries their leads along - whoever
    // owns the customer owns all their lead activity too. Cascades the same
    // way for unassignment (assignedTo === null), keeping the two in sync.
    if (hasAssignmentChanged) {
      const logContext = {
        event: "customer_assignment",
        dealer_id: dealerId,
        customer_id: id,
        previous_assigned_to: previousAssignedTo,
        new_assigned_to: assignedTo,
        assigned_by: String(currentUser._id),
      };

      try {
        const leadResult = await Lead.updateMany(
          { customer_id: id, dealer_id: dealerId },
          { $set: { assigned_to: assignedTo } }
        );

        await Customer.updateOne(
          { _id: id },
          {
            $push: {
              assignment_history: {
                assigned_to: assignedTo,
                assigned_to_name: assigneeUser?.name || null,
                assigned_by: currentUser._id,
                assigned_by_name: currentUser.name || null,
                assigned_at: new Date(),
              },
            },
          }
        );

        console.info(JSON.stringify({ ...logContext, leads_updated: leadResult.modifiedCount, outcome: "success" }));
      } catch (cascadeError) {
        // Not a real DB transaction (no precedent for Mongo sessions/
        // replica-set transactions elsewhere in this codebase, and using one
        // here without confirming the deployment topology risks breaking
        // assignment entirely on a standalone Mongo). Compensate instead:
        // put the customer's own assigned_to back so it never disagrees with
        // leads that failed to update, then surface the failure.
        await Customer.updateOne({ _id: id, dealer_id: dealerId }, { $set: { assigned_to: previousAssignedTo } });
        console.error(JSON.stringify({ ...logContext, outcome: "failed", error: cascadeError.message }));
        return jsonError("Failed to reassign this customer's leads; the assignment was rolled back", 500);
      }
    }

    return NextResponse.json({ data: customer });
  } catch (error) {
    console.error("Customer update failed:", error);
    return jsonError("Internal server error", 500);
  }
}
