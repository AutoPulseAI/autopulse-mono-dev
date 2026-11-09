import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import Role from "@models/Role";
import Permission from "@models/Permission";
import jwt from "jsonwebtoken";
import User from "@models/User";
import { requireActingFor, requireSuperAdmin } from "@lib/apiGuard";


export async function GET(request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // Get the type parameter from the request
    const entity_id = searchParams.get("entity_id"); // Get the entity_id parameter

    // Build the query object
    const query = {};

    // Security fix (Nov 2026): same rule as GET /api/roles (any signed-in user could list any account's roles, and a
    // bad token was a 500): with entity_id that account, without one the super admin.
    const guard = entity_id ? await requireActingFor(request, entity_id) : await requireSuperAdmin(request);
    if (guard.response) return guard.response;
    if (type) {
      query.entity = type;
    }
    
    if (entity_id) {
      query.entity_id = entity_id;
    }

    const roles = await Role.find(query).populate({
      path: "permissions",
      model: "Permission", // Ensure the correct model name
    });

    if (!Array.isArray(roles)) {
      return Response.json([], { status: 200 }); // Always return an array
    }
  
    return Response.json(roles, { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

export async function PUT(req, { params }) {
  // Security fix (Nov 2026): this changed any role's name and permissions with no sign-in (e.g. give a staff role
  // every permission). Now an admin role only by the super admin; a dealer/agency role only by that account
  // (its owner, staff, its agency or a super admin), and only with permissions of the role's own kind.
  try {
    await dbConnect();
    const { id } = await params;
    const { name, permissions } = await req.json();
    console.log(id);
    const role = await Role.findById(id);
    if (!role) {
      return new Response(JSON.stringify({ message: "Role not found" }), { status: 404 });
    }
    const guard = role.entity === "admin" || !role.entity_id
      ? await requireSuperAdmin(req)
      : await requireActingFor(req, String(role.entity_id));
    if (guard.response) return guard.response;
    if (Array.isArray(permissions) && permissions.length) {
      const ids = [...new Set(permissions.map((p) => String(p?._id ?? p)))];
      const own = await Permission.countDocuments({ _id: { $in: ids }, entity: role.entity });
      if (own !== ids.length) {
        return new Response(JSON.stringify({ message: "Those permissions are not for this kind of role." }), { status: 403 });
      }
    }

    role.name = name || role.name;
    role.permissions = permissions || role.permissions;
    await role.save();

    return new Response(JSON.stringify({ 
        message: "Role updated successfully",
        role // Make sure to return the updated role
      }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}