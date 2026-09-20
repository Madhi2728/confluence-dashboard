// Unit tests for the api/chat-confluence.js Vercel serverless function.
// Runs the handler directly (no network, no Vercel CLI) with a mocked
// `fetch` standing in for Groq, so these are deterministic and don't
// require a real GROQ_API_KEY.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createMockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn();
  return res;
}

async function loadHandler() {
  vi.resetModules();
  const mod = await import("../../api/chat-confluence.js");
  return mod.default;
}

const SAMPLE_CONTEXT = {
  profile: {
    insurer: "Ayushman Bharat (PM-JAY)",
    policyType: "Government Health Assurance",
    coverageLimit: 500000,
    roomEligibility: ["General Ward", "Semi-Private"],
    exclusions: ["Private Deluxe Room", "Cosmetic Procedures"],
  },
  hospitals: [
    {
      name: "St. Mary's General Hospital",
      location: "Anna Nagar, Chennai",
      specialty: "Maternity & Neonatal Care",
      network: "In-Network",
      roomTypes: ["General Ward", "Semi-Private", "Private"],
      indicativeCost: 45000,
      matchScore: 99,
      matchReason: "In-network with General Ward & Semi-Private covered under your policy — cashless settlement expected.",
    },
  ],
  stage: { label: "Admission", guidance: "Your policy covers General Ward and Semi-Private rooms." },
  stageIndex: 0,
  stageCount: 4,
};

const realFetch = global.fetch;

describe("api/chat-confluence", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-groq-key";
    delete process.env.GROQ_MODEL;
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
  });

  it("rejects non-POST requests", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body.ok).toBe(false);
  });

  it("500s when GROQ_API_KEY is not configured", async () => {
    delete process.env.GROQ_API_KEY;
    const handler = await loadHandler();
    const res = createMockRes();
    await handler({ method: "POST", body: { message: "hi" } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/GROQ_API_KEY/);
  });

  it("400s when message is missing or empty", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    await handler({ method: "POST", body: { message: "   " } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("sends the patient data grounded in the system prompt, plus history and the message, to Groq's OpenAI-compatible endpoint", async () => {
    const handler = await loadHandler();
    const res = createMockRes();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: "Your policy covers General Ward and Semi-Private." } }] }),
    });

    await handler(
      {
        method: "POST",
        body: {
          message: "What rooms does my policy cover?",
          history: [{ role: "user", text: "hello" }, { role: "assistant", text: "hi there" }],
          context: SAMPLE_CONTEXT,
        },
      },
      res
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-groq-key");

    const sentBody = JSON.parse(init.body);
    expect(sentBody.model).toBe("openai/gpt-oss-120b");
    expect(sentBody.messages[0].role).toBe("system");
    expect(sentBody.messages[0].content).toMatch(/Ayushman Bharat \(PM-JAY\)/);
    expect(sentBody.messages[0].content).toMatch(/St\. Mary's General Hospital/);
    expect(sentBody.messages[0].content).toMatch(/never give a medical diagnosis|Hard rules/i);
    expect(sentBody.messages.at(-1)).toEqual({ role: "user", content: "What rooms does my policy cover?" });
    // Prior turns preserved in order before the new message.
    expect(sentBody.messages[1]).toEqual({ role: "user", content: "hello" });
    expect(sentBody.messages[2]).toEqual({ role: "assistant", content: "hi there" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      model: "openai/gpt-oss-120b",
      reply: "Your policy covers General Ward and Semi-Private.",
    });
  });

  it("retries once on a 429 from Groq, honoring Retry-After, then succeeds", async () => {
    const handler = await loadHandler();
    const res = createMockRes();

    let call = 0;
    global.fetch = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h) => (h.toLowerCase() === "retry-after" ? "0" : null) },
          text: async () => "rate limited",
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ choices: [{ message: { content: "Retried reply." } }] }),
      });
    });

    await handler({ method: "POST", body: { message: "cost?", context: SAMPLE_CONTEXT } }, res);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res.body.reply).toBe("Retried reply.");
  });

  it("gives up after one retry and returns 429 if Groq keeps rate-limiting", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => "still limited",
    });

    await handler({ method: "POST", body: { message: "cost?", context: SAMPLE_CONTEXT } }, res);

    expect(global.fetch).toHaveBeenCalledTimes(2); // 1 initial + 1 retry, then gives up
    expect(res.statusCode).toBe(429);
    expect(res.body.ok).toBe(false);
  });

  it("returns a clear error when the Groq call itself fails (network)", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await handler({ method: "POST", body: { message: "hi", context: SAMPLE_CONTEXT } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Could not reach Groq API/);
  });

  it("honors GROQ_MODEL override", async () => {
    process.env.GROQ_MODEL = "llama-3.1-8b-instant";
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });

    await handler({ method: "POST", body: { message: "hi", context: SAMPLE_CONTEXT } }, res);

    const [, init] = global.fetch.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe("llama-3.1-8b-instant");
    expect(res.body.model).toBe("llama-3.1-8b-instant");
  });
});
