import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import Role from "@models/Role";
import Permission from "@models/Permission";
import User from "@models/User";
import jwt from "jsonwebtoken";

export async function POST(req) {
  try {
    await dbConnect();
    
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId; // Get current user ID

    const { name, entity, permissions } = await req.json();
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

    // Build the query object
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const currentUser = await User.findById(decoded.userId).select('_id name email type');
      if (currentUser) {
        const userPermissions = currentUser?.role?.permissions?.map(p => p.permission_name) || [];
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    }else{
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
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
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const currentUser = await User.findById(decoded.userId).select('_id name email type');
      if (currentUser) {
        const userPermissions = currentUser?.role?.permissions?.map(p => p.permission_name) || [];
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    }else{
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
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

    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const currentUser = await User.findById(decoded.userId).select('_id name email type');
      if (currentUser) {
        const userPermissions = currentUser?.role?.permissions?.map(p => p.permission_name) || [];
      }else{
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
    }else{
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
    const role = await Role.findByIdAndDelete(roleId);
    if (!role) {
      return new Response(JSON.stringify({ message: "Role not found" }), { status: 404 });
    }

    return new Response(JSON.stringify({ message: "Role deleted successfully" }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}
