import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import Role from "@models/Role";
import Permission from "@models/Permission";
import jwt from "jsonwebtoken";
import User from "@models/User";


export async function GET(request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // Get the type parameter from the request
    const entity_id = searchParams.get("entity_id"); // Get the entity_id parameter

    // Build the query object
    const query = {};

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
  try {
    await dbConnect();
    const { id } = await params;
    const { name, permissions } = await req.json();
    console.log(id);
    const role = await Role.findById(id);
    if (!role) {
      return new Response(JSON.stringify({ message: "Role not found" }), { status: 404 });
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