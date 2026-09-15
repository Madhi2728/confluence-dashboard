// Regression test for the "Upload Insurance Card" flow on the Insurance
// Navigator dashboard (ConfluenceDashboard.jsx).
//
// IMPORTANT: handleUploadCard() does not perform real OCR/extraction on the
// uploaded file today -- it ignores the file's contents entirely and, after
// a simulated 1200ms "analyzing" delay, always assigns the hardcoded
// MOCK_EXTRACTION object. This test locks in that *current* mocked
// behavior (uploading any file -> the fixed mock values land in the
// Insurance Summary panel after Save) -- it is not a test of real OCR
// fidelity against the synthetic PM-JAY card's actual printed fields. See
// fixtures/insurance-cards/pmjay_insurance_test_fixture.json for the split
// between the card's ground-truth `fields` and today's mocked
// `expected_ui_state`.
import { describe, it, expect } from "vitest";
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

describe("Insurance Navigator - Upload Insurance Card", () => {
  it("populates the Insurance Summary panel with the mocked extraction after uploading the PM-JAY test card", async () => {
    const user = userEvent.setup();
    render(<ConfluenceDashboard />);

    // The Insurance Summary panel and its upload control live on the
    // "Insurance Navigator" tab, not the default "Admission Ops" tab.
    await user.click(screen.getByRole("button", { name: "Insurance Navigator" }));

    const fileInput = screen.getByLabelText(/upload insurance card/i);
    await user.upload(fileInput, loadCardFile());

    // handleUploadCard shows "Analyzing document..." then, ~1200ms later,
    // switches the panel into its editable form pre-filled with the mock
    // extraction and a "Save" action.
    const saveButton = await screen.findByRole(
      "button",
      { name: "Save" },
      { timeout: 3000 }
    );
    await user.click(saveButton);

    const expected = fixture.expected_ui_state.insurance_summary_panel;

    expect(summaryValue("Insurer")).toBe(expected["Insurer"]);
    expect(summaryValue("Policy Type")).toBe(expected["Policy Type"]);
    expect(summaryValue("Coverage Limit")).toBe(expected["Coverage Limit"]);
    expect(summaryValue("Room Eligibility")).toBe(expected["Room Eligibility"]);
    expect(summaryValue("Exclusions")).toBe(expected["Exclusions"]);
  });
});
