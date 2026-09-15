// Vercel serverless function (Node.js runtime, auto-detected from /api).
//
// POST an insurance-card image, get back structured fields extracted by
// Gemini. GEMINI_API_KEY is read from server-side env vars only -- it is
// never sent to, or readable by, the browser; the client only ever talks
// to this endpoint, never to Gemini directly.

// gemini-2.5-flash is retired for newer accounts (Gemini itself returns a
// 404 pointing at its replacement) -- confirmed live against this account,
// see the extraction test run in the PR/commit history. Override via
// GEMINI_MODEL if your account's AI Studio console shows something else.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

function geminiEndpoint(apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
}

const REQUIRED_KEYS = [
  "policy_holder_name",
  "policy_number",
  "insurer",
  "policy_type",
  "coverage_limit",
  "room_eligibility",
  "exclusions",
  "valid_from",
  "valid_until",
];

// Gemini structured-output schema (REST format: uppercase Type enum names).
// `required` here means "always include this key in the JSON", not "must be
// non-null" -- every scalar is `nullable: true` so the model has an explicit,
// schema-sanctioned way to say "I can't read this" instead of guessing.
const EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    policy_holder_name: { type: "STRING", nullable: true },
    policy_number: { type: "STRING", nullable: true },
    insurer: { type: "STRING", nullable: true },
    policy_type: { type: "STRING", nullable: true },
    coverage_limit: { type: "STRING", nullable: true },
    room_eligibility: { type: "ARRAY", items: { type: "STRING" } },
    exclusions: { type: "ARRAY", items: { type: "STRING" } },
    valid_from: { type: "STRING", nullable: true },
    valid_until: { type: "STRING", nullable: true },
  },
  required: REQUIRED_KEYS,
};

const PROMPT = `You are extracting structured data from a photo or scan of a health insurance policy card / e-card (e.g. Ayushman Bharat / PM-JAY, CGHS, ESIC, or a private insurer's card).

Return ONLY the fields defined by the response schema. For each field:
- Read it directly from the card image -- do not infer, guess, or fill in typical/plausible values.
- If a field is not present on the card, is illegible, or you are not confident you read it correctly, set it to null (for room_eligibility / exclusions, use an empty array [] instead of null when nothing legible is listed).
- coverage_limit should be the coverage/sum-insured amount as printed on the card (e.g. "₹5.00L", "Rs. 5,00,000"), as text -- do not convert units yourself.
- room_eligibility and exclusions should each be a list of short strings as printed or clearly implied on the card (e.g. ["General Ward", "Semi-Private"]).
- valid_from and valid_until are the policy's validity dates if printed, in the format shown on the card.

Never invent a policy holder name, policy number, insurer, or amount that is not actually visible on the card. When in doubt, prefer null over a guess -- this data is used for real insurance coverage decisions.`;

function jsonError(res, status, error, extra) {
  return res.status(status).json({ ok: false, error, ...extra });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonError(res, 405, "Method not allowed. Use POST.");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonError(res, 500, "GEMINI_API_KEY is not configured on the server.");
  }

  const body = req.body || {};
  const { imageBase64, mimeType } = body;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return jsonError(
      res,
      400,
      "Request body must include 'imageBase64' (a base64-encoded image, with or without a data: URL prefix)."
    );
  }

  // Accept either a bare base64 string or a full "data:image/png;base64,..." URL.
  const base64Data = imageBase64.startsWith("data:") && imageBase64.includes(",")
    ? imageBase64.slice(imageBase64.indexOf(",") + 1)
    : imageBase64;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType: mimeType || "image/png", data: base64Data } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_SCHEMA,
      temperature: 0,
    },
  };

  let geminiResponse;
  try {
    geminiResponse = await fetch(geminiEndpoint(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    return jsonError(res, 502, `Could not reach Gemini API: ${err.message}`);
  }

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text().catch(() => "");
    return jsonError(res, 502, `Gemini API returned ${geminiResponse.status}.`, {
      details: errText.slice(0, 500),
    });
  }

  let payload;
  try {
    payload = await geminiResponse.json();
  } catch {
    return jsonError(res, 502, "Gemini API returned a non-JSON response.");
  }

  const candidate = payload?.candidates?.[0];
  const rawText = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
  if (!rawText) {
    return jsonError(res, 502, "Gemini API returned no extractable text.", {
      finishReason: candidate?.finishReason || null,
    });
  }

  let extracted;
  try {
    extracted = JSON.parse(rawText);
  } catch {
    return jsonError(res, 502, "Gemini API response was not valid JSON.", {
      raw: rawText.slice(0, 500),
    });
  }

  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    return jsonError(res, 502, "Gemini API response JSON was not an object.");
  }

  // Normalize: every key present, arrays are always arrays, never trust the
  // model to have honored the schema's `required` list perfectly.
  const data = {};
  for (const key of REQUIRED_KEYS) {
    const value = extracted[key];
    if (key === "room_eligibility" || key === "exclusions") {
      data[key] = Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
    } else {
      data[key] = typeof value === "string" && value.trim() ? value : null;
    }
  }

  return res.status(200).json({ ok: true, model: MODEL, data });
}
