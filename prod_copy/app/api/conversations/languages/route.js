import { NextResponse } from "next/server";
import { getAgentViewLanguages } from "@lib/restcountriesLanguages";

export const runtime = "nodejs";
export const revalidate = 604800;

export async function GET() {
  const { languages, source } = await getAgentViewLanguages();
  return NextResponse.json(
    { languages, source, count: languages.length },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}
