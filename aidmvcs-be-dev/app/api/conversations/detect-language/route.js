import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini";

function getOpenAiKey() {
  return process.env.OPENAPI_KEY || process.env.OPENAI_API_KEY || "";
}

export async function POST(req) {
  try {
    const apiKey = getOpenAiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key is not configured." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 8000) : "";

    if (!text) {
      return NextResponse.json({ languageName: "English" }, { status: 200 });
    }

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Detect the primary natural language of the user message. Reply with JSON only: {"languageName":"<English name of language>"} Examples: English, Spanish, French. If uncertain, use English.',
          },
          { role: "user", content: text },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("detect-language OpenAI error:", response.status, errText);
      return NextResponse.json({ languageName: "English" }, { status: 200 });
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ languageName: "English" }, { status: 200 });
    }

    const languageName =
      typeof parsed?.languageName === "string" ? parsed.languageName.trim() : "English";

    return NextResponse.json(
      { languageName: languageName || "English" },
      { status: 200 }
    );
  } catch (error) {
    console.error("POST /api/conversations/detect-language error:", error);
    return NextResponse.json({ languageName: "English" }, { status: 200 });
  }
}
