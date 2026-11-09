import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import Role from "@models/Role";
import Permission from "@models/Permission";
import User from "@models/User";
import jwt from "jsonwebtoken";
import { requireUser, requireActingFor, requireSuperAdmin } from "@lib/apiGuard";
import { roleEditGuard, foreignPermissions } from "@lib/roleAccess";

export async function POST(req) {
  try {
    await dbConnect();
    
    // Security fix (Nov 2026): a bad token was a 500 and the caller could pick any entity (a dealer could create an
    // "admin" role) with any permissions. Now a valid sign-in, the caller's own kind of role, and permissions of it.
    const signedIn = await requireUser(req);
    if (signedIn.response) return signedIn.response;
    const userId = signedIn.user._id; // Get current user ID
    const { name, entity, permissions } = await req.json();
    if (entity !== signedIn.user.type) {
      return new Response(JSON.stringify({ message: "You can only create roles for your own account." }), { status: 403 });
    }
    const foreign = await foreignPermissions(permissions, entity);
    if (foreign) return foreign;
    if(entity !=='admin'){
      const existingRole = await Role.findOne({ name, entity,entity_id:userId });
      if (existingRole) {
        return new Response(JSON.stringify({ message: "Role already exists" }), { status: 400 });
      }
    }else{
      const existingRole = await Role.findOne({ name, entity });
      if (existingRole) {
        return new Response(JSON.stringify({ message: "Role already exists" }), { status: 400 });
      }
    }

    const newRole = new Role({
      name,
      entity,
      permissions,
      entity_id: userId, // Assign the current user ID
    });

    await newRole.save();
    return new Response(JSON.stringify({ message: "Role created successfully", role: newRole }), { status: 201 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

export async function GET(request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // Get the type parameter from the request
    const entity_id = searchParams.get("entity_id"); // Get the entity_id parameter

    // Security fix (Nov 2026): any signed-in user could list any account's roles. With entity_id: that account (its
    // owner/staff, its agency or a super admin); without one (the admin's role pages): super admin.
    const guard = entity_id ? await requireActingFor(request, entity_id) : await requireSuperAdmin(request);
    if (guard.response) return guard.response;

    const query = {};
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

export async function PUT(req) {
  try {
    await dbConnect();
    const { roleId, name, permissions } = await req.json();

    const role = await Role.findById(roleId);
    if (!role) {
      return new Response(JSON.stringify({ message: "Role not found" }), { status: 404 });
    }
    // Security fix (Nov 2026): any signed-in user could rename any role or give it any permissions.
    const guard = await roleEditGuard(req, role);
    if (guard.response) return guard.response;
    const foreign = await foreignPermissions(permissions, role.entity);
    if (foreign) return foreign;
    role.name = name || role.name;
    role.permissions = permissions || role.permissions;
    await role.save();

    return new Response(JSON.stringify({ message: "Role updated successfully" }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    await dbConnect();
    const { roleId } = await req.json();

    // Security fix (Nov 2026): any signed-in user could delete any role.
    const signedIn = await requireUser(req);
    if (signedIn.response) return signedIn.response;
    const found = await Role.findById(roleId);
    if (found) {
      const guard = await roleEditGuard(req, found);
      if (guard.response) return guard.response;
    }
    const role = found ? await Role.findByIdAndDelete(roleId) : null;
    if (!role) {
      return new Response(JSON.stringify({ message: "Role not found" }), { status: 404 });
    }

    return new Response(JSON.stringify({ message: "Role deleted successfully" }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}
