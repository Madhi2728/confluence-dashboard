// Tests for AskConfluence.jsx's Groq-backed send handler, rendered directly
// (not through ConfluenceDashboard) with a minimal context, mocking `fetch`
// at the client boundary. The endpoint itself (Groq call, retry, prompt
// construction) is covered separately in test/api/chat-confluence.test.js.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AskConfluence from "../src/AskConfluence.jsx";

const CONTEXT = {
  profile: {
    insurer: "Ayushman Bharat (PM-JAY)",
    policyType: "Government Health Assurance",
    coverageLimit: 500000,
    roomEligibility: ["General Ward", "Semi-Private"],
    exclusions: ["Private Deluxe Room"],
  },
  hospitals: [
    {
      name: "St. Mary's General Hospital",
      location: "Anna Nagar, Chennai",
      specialty: "Maternity & Neonatal Care",
      network: "In-Network",
      roomTypes: ["General Ward", "Semi-Private"],
      indicativeCost: 45000,
      matchScore: 99,
      matchReason: "In-network, rooms covered.",
    },
  ],
  stage: { label: "Admission", guidance: "Covers General Ward and Semi-Private." },
  stageIndex: 0,
  stageCount: 4,
};

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("AskConfluence chatbot (Groq-backed)", () => {
  it("sends a typed question to /api/chat-confluence, shows a typing indicator, then the real reply", async () => {
    const user = userEvent.setup();
    let resolveFetch;
    global.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({
              ok: true,
              json: async () => ({ ok: true, model: "openai/gpt-oss-120b", reply: "Your policy covers General Ward and Semi-Private." }),
            });
        })
    );

    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    await user.type(screen.getByPlaceholderText(/ask about coverage/i), "What rooms does my policy cover?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/chat-confluence",
      expect.objectContaining({ method: "POST" })
    );
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.message).toBe("What rooms does my policy cover?");
    expect(sentBody.context).toEqual(CONTEXT);

    expect(screen.getByText("What rooms does my policy cover?")).toBeInTheDocument();
    expect(document.querySelector(".chat-bubble.typing")).toBeInTheDocument();

    resolveFetch();
    expect(await screen.findByText("Your policy covers General Ward and Semi-Private.")).toBeInTheDocument();
    expect(document.querySelector(".chat-bubble.typing")).toBeNull();
  });

  it("a quick-prompt chip goes through the exact same real pipeline as typed text", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, model: "openai/gpt-oss-120b", reply: "Cashless works at in-network hospitals." }),
    });

    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    await user.click(screen.getByRole("button", { name: "Is this cashless or reimbursement?" }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.message).toBe("Is this cashless or reimbursement?");
    expect(await screen.findByText("Cashless works at in-network hospitals.")).toBeInTheDocument();
  });

  it("blocks a diagnosis-shaped question client-side with a guardrail reply, never calling the API", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn();

    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    await user.type(screen.getByPlaceholderText(/ask about coverage/i), "What disease do I have?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/can't provide or interpret a medical diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText("Outside decision-support scope")).toBeInTheDocument();
  });

  it("shows a clear, distinct error message (no silent fail) when the endpoint call fails", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    await user.type(screen.getByPlaceholderText(/ask about coverage/i), "What will this cost me?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const errorBubble = await screen.findByText(/couldn't reach the assistant/i);
    expect(errorBubble).toBeInTheDocument();
    expect(errorBubble.closest(".chat-bubble")).toHaveClass("error");
  });

  it("throttles: Send and the input are disabled while a request is in flight, re-enabled after", async () => {
    const user = userEvent.setup();
    let resolveFetch;
    global.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: true, json: async () => ({ ok: true, reply: "done" }) });
        })
    );

    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const input = screen.getByPlaceholderText(/ask about coverage/i);
    const sendBtn = screen.getByRole("button", { name: /send/i });
    await user.type(input, "cost?");
    await user.click(sendBtn);

    expect(sendBtn).toBeDisabled();
    expect(input).toBeDisabled();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch();
    await screen.findByText("done");
    expect(sendBtn).not.toBeDisabled();
    expect(input).not.toBeDisabled();
  });

  it("propagates prior turns as history, in order, on a second message", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, reply: "some reply" }),
    });

    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const input = screen.getByPlaceholderText(/ask about coverage/i);
    await user.type(input, "first question");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText("some reply");

    await user.type(input, "second question");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const secondCallBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(secondCallBody.message).toBe("second question");
    expect(secondCallBody.history).toEqual([
      { role: "user", text: "first question" },
      { role: "assistant", text: "some reply" },
    ]);
  });
});
