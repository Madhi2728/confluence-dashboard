// Unit tests for the api/extract-insurance-card.js Vercel serverless
// function. Runs the handler directly (no network, no Vercel CLI) with a
// mocked `fetch` standing in for the Gemini API, so these are deterministic
// and don't require a real GEMINI_API_KEY.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/insurance-cards/pmjay_insurance_test_fixture.json";

// A real (tiny, 1x1) PNG, base64-encoded -- just needs to be a plausible
// payload; the mocked Gemini call never actually decodes it.
const TINY_BASE64_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function createMockRes() {
  const res = { statusCode: null, body: null };
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

// The module reads GEMINI_MODEL/GEMINI_API_KEY at import time (for the
// MODEL constant) and at call time (for the key), so re-import fresh for
// every test after setting env vars.
async function loadHandler() {
  vi.resetModules();
  const mod = await import("../../api/extract-insurance-card.js");
  return mod.default;
}

const realFetch = global.fetch;

describe("api/extract-insurance-card", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("rejects non-POST requests", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body.ok).toBe(false);
  });

  it("500s when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;
    const handler = await loadHandler();
    const res = createMockRes();
    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/GEMINI_API_KEY/);
  });

  it("400s when imageBase64 is missing", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    await handler({ method: "POST", body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it("calls Gemini with the image + strict-JSON schema, and returns the normalized fields for the real PM-JAY card content", async () => {
    const handler = await loadHandler();
    const res = createMockRes();

    // Stand-in for Gemini: candidates[0].content.parts[].text carries the
    // model's JSON string. fixture.fields is the ground truth printed on
    // the synthetic PM-JAY card -- a correct extraction should read this.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(fixture.fields) }] }, finishReason: "STOP" },
        ],
      }),
    });

    await handler(
      { method: "POST", body: { imageBase64: TINY_BASE64_PNG, mimeType: "image/png" } },
      res
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-3.6-flash"); // default model
    expect(url).toContain("key=test-key");

    const sentBody = JSON.parse(init.body);
    const parts = sentBody.contents[0].parts;
    expect(parts.find((p) => p.inlineData)?.inlineData).toEqual({
      mimeType: "image/png",
      data: TINY_BASE64_PNG,
    });
    expect(sentBody.generationConfig.responseSchema).toBeTruthy();
    expect(sentBody.generationConfig.responseMimeType).toBe("application/json");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      model: "gemini-3.6-flash",
      data: {
        policy_holder_name: fixture.fields.policy_holder_name,
        policy_number: fixture.fields.policy_number,
        insurer: fixture.fields.insurer,
        policy_type: fixture.fields.policy_type,
        coverage_limit: fixture.fields.coverage_limit,
        room_eligibility: fixture.fields.room_eligibility,
        exclusions: fixture.fields.exclusions,
        valid_from: fixture.fields.valid_from,
        valid_until: fixture.fields.valid_until,
      },
    });
  });

  it("normalizes a null/missing field to null rather than dropping or guessing it", async () => {
    const handler = await loadHandler();
    const res = createMockRes();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    ...fixture.fields,
                    policy_type: null,
                    exclusions: [],
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    });

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    expect(res.body.data.policy_type).toBeNull();
    expect(res.body.data.exclusions).toEqual([]);
    expect(res.body.data.insurer).toBe(fixture.fields.insurer);
  });

  it("returns a clear error when the Gemini call itself fails", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Could not reach Gemini API/);
  });

  it("retries a 503 up to MAX_GEMINI_ATTEMPTS (3), then reports it, when Gemini keeps saying 'high demand'", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    // Matches the actual response seen in a live run against this account's
    // free tier: HTTP 503, status "UNAVAILABLE".
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({
          error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" },
        }),
    });

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    expect(global.fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries, then gives up
    expect(res.statusCode).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Gemini API returned 503/);
  }, 10000); // 2 real ~1.5s backoff delays -- padded against flakiness when the full suite runs under load

  it("retries once on a 503 and returns the successful result from the retry, without the client ever seeing the transient failure", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    let call = 0;
    global.fetch = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { code: 503, status: "UNAVAILABLE" } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.fields) }] }, finishReason: "STOP" }],
        }),
      });
    });

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.insurer).toBe(fixture.fields.insurer);
  }, 10000); // real ~1.5s backoff delay -- padded against flakiness when the full suite runs under load

  it("does NOT retry a non-503 failure (e.g. a bad request) -- fails fast on the first attempt", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { code: 400, message: "Invalid request." } }),
    });

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    expect(global.fetch).toHaveBeenCalledTimes(1); // no retry attempted
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Gemini API returned 400/);
  });

  it("does NOT retry a 503 once the time budget is exhausted -- avoids risking a FUNCTION_INVOCATION_TIMEOUT", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { code: 503, status: "UNAVAILABLE" } }),
    });

    // Simulate the first attempt alone having already burned ~50s of the
    // ~55s budget (the 47.9s/54s cases observed live) -- Date.now() is read
    // for `startedAt`, again to size attempt 1's own AbortController
    // timeout (negligible elapsed at that point), then again to compute
    // elapsed time after the first failed attempt.
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValueOnce(1_000_000); // startedAt
    dateSpy.mockReturnValueOnce(1_000_000); // elapsedBefore attempt 1 (sizing its timeout)
    dateSpy.mockReturnValueOnce(1_000_000 + 50_000); // elapsed check after attempt 1
    dateSpy.mockReturnValue(1_000_000 + 50_000); // anything further, if ever read again

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    expect(global.fetch).toHaveBeenCalledTimes(1); // gave up immediately, no retry attempted
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Gemini API returned 503/);
    dateSpy.mockRestore();
  });

  it("aborts a single Gemini call that hangs past its allotted time, returning a controlled error instead of risking a platform timeout", async () => {
    vi.useFakeTimers(); // this attempt's own timeout is ~52s -- fast-forward rather than really wait
    try {
      const handler = await loadHandler();
      const res = createMockRes();

      // A fetch that never resolves on its own -- only rejects if its signal
      // is aborted, exactly like a real hung request behaves once our own
      // AbortController fires.
      global.fetch = vi.fn((url, init) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        });
      });

      const handlerPromise = handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);
      await vi.advanceTimersByTimeAsync(60000); // past the ~52s attempt timeout
      await handlerPromise;

      expect(global.fetch).toHaveBeenCalledTimes(1); // aborted with no budget left for a retry -- gave up
      expect(res.statusCode).toBe(502);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a clear error when Gemini's response text isn't valid JSON", async () => {
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "not json" }] }, finishReason: "STOP" }],
      }),
    });

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not valid JSON/);
  });

  it("honors GEMINI_MODEL when set", async () => {
    process.env.GEMINI_MODEL = "gemini-flash-latest";
    const handler = await loadHandler();
    const res = createMockRes();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.fields) }] }, finishReason: "STOP" }],
      }),
    });

    await handler({ method: "POST", body: { imageBase64: TINY_BASE64_PNG } }, res);

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("gemini-flash-latest");
    expect(res.body.model).toBe("gemini-flash-latest");
  });
});
