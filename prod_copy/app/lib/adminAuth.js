import { NextResponse } from "next/server";
import { verifyToken } from "@lib/auth";

export function getTokenFromRequest(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.replace("Bearer ", "");
}

export function requireAdmin(request) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  }

  if (decoded.type !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { decoded };
}
