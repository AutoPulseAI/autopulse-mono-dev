import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini";
const BATCH_SIZE = Number.parseInt(process.env.OPENAI_TRANSLATION_BATCH_SIZE || "8", 10);
const MAX_TEXT_LENGTH = 4000;

function getOpenAiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY || "";
}

function normalizeMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const id = String(msg.id || "").trim();
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!id || !text) return null;
  return { id, text: text.slice(0, MAX_TEXT_LENGTH) };
}

/** Same JSON shape as we return to the client: id → translatedText map. */
function translationsArrayToMap(rows) {
  const map = {};
  if (!Array.isArray(rows)) return map;
  rows.forEach((row) => {
    const id = String(row?.id || "").trim();
    const translatedText =
      typeof row?.translatedText === "string" ? row.translatedText.trim() : "";
    if (id && translatedText) map[id] = translatedText;
  });
  return map;
}

/**
 * OpenAI: one API call per batch (chunked in POST handler for token safety).
 */
async function translateBatch(messages, targetLanguage, sourceHint) {
  const systemPrompt = [
    "You are a translation engine for CRM conversations.",
    `Translate each message to ${targetLanguage}.`,
    "Keep names, phone numbers, links, and dealer names unchanged.",
    "Do not add any explanation.",
    "Return strict JSON only in this shape:",
    '{"translations":[{"id":"<id>","translatedText":"<text>"}]}',
  ].join(" ");

  const userPayload = {
    sourceHint: sourceHint || null,
    messages,
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  return translationsArrayToMap(parsed?.translations);
}

/**
 * Third-party: single HTTP call with the entire messages array (no chunking).
 * Expects JSON body response: { translations: [{ id, translatedText }] }
 * (same shape as OpenAI’s parsed payload).
 */
async function translateBatchThirdParty(messages, targetLanguage, sourceHint) {
  const url = process.env.TRANSLATION_THIRD_PARTY_URL;
  if (!url) {
    throw new Error("TRANSLATION_THIRD_PARTY_URL is not configured.");
  }

  const headers = {
    "Content-Type": "application/json",
  };

  const apiKey =
    process.env.TRANSLATION_THIRD_PARTY_API_KEY ||
    process.env.TRANSLATION_THIRD_PARTY_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const extraHeader = process.env.TRANSLATION_THIRD_PARTY_HEADER;
  const extraValue = process.env.TRANSLATION_THIRD_PARTY_HEADER_VALUE;
  if (extraHeader && extraValue) {
    headers[extraHeader] = extraValue;
  }
  console.log(messages);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      targetLanguage,
      sourceHint: sourceHint || null,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Third-party translation failed: ${response.status} ${errorText}`
    );
  }

  const data = await response.json();
  const rows = Array.isArray(data?.translations) ? data.translations : [];
  return translationsArrayToMap(rows);
}

function useThirdPartyProvider() {
  return (
    (process.env.TRANSLATION_PROVIDER || "").toLowerCase().trim() ===
    "third_party"
  );
}

export async function POST(req) {
  try {
    const body = await req.json();
    const targetLanguage = String(body?.targetLanguage || "").trim();
    const sourceHint =
      typeof body?.sourceHint === "string" ? body.sourceHint.trim() : "";
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    const messages = rawMessages.map(normalizeMessage).filter(Boolean);

    if (!targetLanguage) {
      return NextResponse.json(
        { error: "targetLanguage is required." },
        { status: 400 }
      );
    }

    if (!messages.length) {
      return NextResponse.json({ translations: {}, failedIds: [] }, { status: 200 });
    }

    const translations = {};
    const failedIds = [];

    if (useThirdPartyProvider()) {
      if (!process.env.TRANSLATION_THIRD_PARTY_URL) {
        return NextResponse.json(
          {
            error:
              "TRANSLATION_THIRD_PARTY_URL is required when TRANSLATION_PROVIDER is third_party.",
          },
          { status: 500 }
        );
      }
      try {
        const batchMap = await translateBatchThirdParty(
          messages,
          targetLanguage,
          sourceHint
        );
        messages.forEach((msg) => {
          if (batchMap[msg.id]) translations[msg.id] = batchMap[msg.id];
          else failedIds.push(msg.id);
        });
      } catch (err) {
        messages.forEach((msg) => failedIds.push(msg.id));
        console.error("Third-party translation failed:", err);
      }
    } else {
      if (!getOpenAiKey()) {
        return NextResponse.json(
          { error: "OpenAI API key is not configured." },
          { status: 500 }
        );
      }

      // If OPENAI_TRANSLATION_BATCH_SIZE <= 0, do a single OpenAI call with the full payload.
      const batchSize = Number.isFinite(BATCH_SIZE) ? BATCH_SIZE : 8;
      if (batchSize <= 0) {
        try {
          const batchMap = await translateBatch(messages, targetLanguage, sourceHint);
          messages.forEach((msg) => {
            if (batchMap[msg.id]) translations[msg.id] = batchMap[msg.id];
            else failedIds.push(msg.id);
          });
        } catch (err) {
          messages.forEach((msg) => failedIds.push(msg.id));
          console.error("Single-call translation failed:", err);
        }
      } else {
        for (let i = 0; i < messages.length; i += batchSize) {
          const batch = messages.slice(i, i + batchSize);
          try {
            const batchMap = await translateBatch(batch, targetLanguage, sourceHint);
            batch.forEach((msg) => {
              if (batchMap[msg.id]) translations[msg.id] = batchMap[msg.id];
              else failedIds.push(msg.id);
            });
          } catch (err) {
            batch.forEach((msg) => failedIds.push(msg.id));
            console.error("Translation batch failed:", err);
          }
        }
      }
    }

    return NextResponse.json({ translations, failedIds }, { status: 200 });
  } catch (error) {
    console.error("POST /api/conversations/translate error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
