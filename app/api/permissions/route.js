import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import Permission from "@models/Permission";
import { EXPORT_DETAIL } from "next/dist/shared/lib/constants";
import { REPL_MODE_SLOPPY } from "repl";

export async function GET(request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // Get the type parameter from the request

    // Filter roles based on type if provided
    const query = type ? {entity:type } : {};
    const permission = await Permission.find(query);
    return new Response(JSON.stringify(permission), { status: 200 });
  }catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}