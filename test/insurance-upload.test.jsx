// Tests for the "Upload Insurance Card" flow on the Insurance Navigator
// dashboard (ConfluenceDashboard.jsx). handleUploadCard() now calls the
// real POST /api/extract-insurance-card endpoint (Gemini-backed); these
// tests mock `fetch` at the client boundary rather than hitting a live
// server, so they run deterministically offline. The endpoint itself
// (Gemini call, JSON parsing/normalization) is covered separately in
// test/api/extract-insurance-card.test.js.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import ConfluenceDashboard from "../src/ConfluenceDashboard.jsx";
import fixture from "./fixtures/insurance-cards/pmjay_insurance_test_fixture.json";

const CARD_PNG_PATH = path.resolve(
  process.cwd(),
  "test/fixtures/insurance-cards/synthetic_pmjay_insurance_card.png"
);

function loadCardFile() {
  const bytes = fs.readFileSync(CARD_PNG_PATH);
  return new File([bytes], "synthetic_pmjay_insurance_card.png", { type: "image/png" });
}

// Reads one "<label> <b>value</b></div>" row out of the read-only Insurance
// Summary panel, keyed by its visible label text (e.g. "Insurer").
function summaryValue(label) {
  const row = screen.getByText(label).closest(".ins-row");
  return within(row).getByText((_, el) => el.tagName === "B").textContent;
}

async function uploadCard(user) {
  await user.click(screen.getByRole("button", { name: "Insurance Navigator" }));
  const fileInput = screen.getByLabelText(/upload insurance card/i);
  await user.upload(fileInput, loadCardFile());
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("Insurance Navigator - Upload Insurance Card", () => {
  it("populates the Insurance Summary panel from a real, successful extraction that reflects the PM-JAY card's actual content", async () => {
    const user = userEvent.setup();

    // Simulate what POST /api/extract-insurance-card returns on success --
    // fixture.fields is the ground truth printed on the synthetic PM-JAY
    // card, i.e. what a correct Gemini extraction should read back.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, model: "gemini-2.5-flash", data: fixture.fields }),
    });

    render(<ConfluenceDashboard />);
    await uploadCard(user);

    const saveButton = await screen.findByRole("button", { name: "Save" }, { timeout: 3000 });
    // A fully-read card should show no "couldn't be read" warning.
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(saveButton);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/extract-insurance-card",
      expect.objectContaining({ method: "POST" })
    );

    // These are the PM-JAY card's real values (Ayushman Bharat / PM-JAY,
    // ₹5.00L, General Ward + Semi-Private, ...) -- not the old
    // always-identical MOCK_EXTRACTION (Star Health, ₹3.00L, ...).
    expect(summaryValue("Insurer")).toBe("Ayushman Bharat (PM-JAY)");
    expect(summaryValue("Policy Type")).toBe("Government Health Assurance");
    expect(summaryValue("Coverage Limit")).toBe("₹5.00L");
    expect(summaryValue("Room Eligibility")).toBe("General Ward, Semi-Private");
    expect(summaryValue("Exclusions")).toBe("Private Deluxe Room, Cosmetic Procedures");
  });

  it("shows an inline warning and leaves fields blank for manual review when extraction returns nulls, instead of guessing", async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        model: "gemini-2.5-flash",
        data: {
          policy_holder_name: "TEST PERSON DEMO",
          policy_number: null,
          insurer: "Ayushman Bharat (PM-JAY)",
          policy_type: null, // e.g. glare/crop hid this field
          coverage_limit: "₹5.00L",
          room_eligibility: ["General Ward", "Semi-Private"],
          exclusions: [],
          valid_from: null,
          valid_until: null,
        },
      }),
    });

    render(<ConfluenceDashboard />);
    await uploadCard(user);

    await screen.findByRole("button", { name: "Save" }, { timeout: 3000 });
    expect(
      screen.getByText(/some fields couldn't be read.*review and edit manually/i)
    ).toBeInTheDocument();
  });

  it("falls back to the demo mock (with a visible warning) when the extraction endpoint is unreachable", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    render(<ConfluenceDashboard />);
    await uploadCard(user);

    const saveButton = await screen.findByRole("button", { name: "Save" }, { timeout: 3000 });
    expect(
      screen.getByText(/couldn't reach the extraction service.*placeholder demo data/i)
    ).toBeInTheDocument();
    await user.click(saveButton);

    // Fallback path -- still the known MOCK_EXTRACTION values, so a live
    // Gemini outage never breaks the demo.
    expect(summaryValue("Insurer")).toBe("Star Health — Family Health Optima");
    expect(summaryValue("Policy Type")).toBe("Family Floater (Individual Coverage)");
    expect(summaryValue("Coverage Limit")).toBe("₹3.00L");
    expect(summaryValue("Room Eligibility")).toBe("Semi-Private, Private");
    expect(summaryValue("Exclusions")).toBe("ICU Suite, Cosmetic Procedures");
  });

  it("falls back to the demo mock when the endpoint itself reports a Gemini 503 (free-tier overload, observed live)", async () => {
    const user = userEvent.setup();
    // What the client actually receives from /api/extract-insurance-card
    // when Gemini answers 503 -- the fetch to our own endpoint still
    // resolves (HTTP 502 from us), just with { ok: false, error: ... }.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: "Gemini API returned 503." }),
    });

    render(<ConfluenceDashboard />);
    await uploadCard(user);

    const saveButton = await screen.findByRole("button", { name: "Save" }, { timeout: 3000 });
    expect(
      screen.getByText(/couldn't reach the extraction service.*placeholder demo data/i)
    ).toBeInTheDocument();
    await user.click(saveButton);

    expect(summaryValue("Insurer")).toBe("Star Health — Family Health Optima");
    expect(summaryValue("Coverage Limit")).toBe("₹3.00L");
  });
});
