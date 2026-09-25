// Verifies voice input in the "Ask Confluence" chatbot (AskConfluence.jsx),
// used identically in Insurance Navigator and Admission Ops's Patient View --
// same component, so these tests cover both call sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AskConfluence from "../src/AskConfluence.jsx";

const CONTEXT = {
  profile: { insurer: "Ayushman Bharat (PM-JAY)", policyType: "Government Health Assurance", coverageLimit: 500000, roomEligibility: ["General Ward"], exclusions: [] },
  hospitals: [],
};

class MockSpeechRecognition {
  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend && this.onend();
  }
}
MockSpeechRecognition.instances = [];

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  MockSpeechRecognition.instances = [];
  vi.restoreAllMocks();
});

describe("Ask Confluence -- voice input (mic button)", () => {
  it("click mic -> pulsing 'listening' state -> transcript fills input (not auto-sent) -> Send works exactly as typed text would", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, reply: "real reply text" }) });

    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const micBtn = screen.getByTitle("Speak your question");
    expect(micBtn).not.toBeDisabled();
    await user.click(micBtn);

    expect(micBtn).toHaveClass("listening");
    expect(micBtn).toHaveAttribute("title", "Stop listening");
    const recog = MockSpeechRecognition.instances[0];
    expect(recog.started).toBe(true);

    act(() => {
      recog.onresult({ results: [[{ transcript: "what rooms does my policy cover" }]] });
    });

    const input = document.querySelector(".chat-input");
    expect(input.value).toBe("what rooms does my policy cover");
    expect(global.fetch).not.toHaveBeenCalled(); // never auto-sent

    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).message).toBe("what rooms does my policy cover");
    expect(await screen.findByText("real reply text")).toBeInTheDocument();
  });

  it("clicking the mic again while listening stops it", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const micBtn = screen.getByTitle("Speak your question");
    await user.click(micBtn);
    expect(micBtn).toHaveClass("listening");

    await user.click(screen.getByTitle("Stop listening"));
    expect(micBtn).not.toHaveClass("listening");
    expect(MockSpeechRecognition.instances[0].onend).toBeTruthy(); // stop() invoked onend
  });

  it("permission denial (or any recognition error) shows an inline message instead of failing silently", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    await user.click(screen.getByTitle("Speak your question"));
    const recog = MockSpeechRecognition.instances[0];

    act(() => {
      recog.onerror({ error: "not-allowed" });
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/microphone access was blocked/i);
    expect(document.querySelector(".chat-icon-btn.listening")).toBeNull(); // no longer stuck "listening"

    // Dismissible.
    await user.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starting a new listen attempt clears a previous error message", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const micBtn = screen.getByTitle("Speak your question");
    await user.click(micBtn);
    act(() => {
      MockSpeechRecognition.instances[0].onerror({ error: "no-speech" });
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(micBtn);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("when SpeechRecognition is unsupported, the mic button stays visible but disabled with an explanatory tooltip (not hidden, not silently broken)", () => {
    // No window.SpeechRecognition / webkitSpeechRecognition defined.
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const micBtn = screen.getByTitle("Voice input not supported in this browser");
    expect(micBtn).toBeInTheDocument();
    expect(micBtn).toBeDisabled();
  });

  it("clicking a disabled (unsupported) mic button does nothing -- no crash, no listening state", async () => {
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const micBtn = screen.getByTitle("Voice input not supported in this browser");
    await user.click(micBtn); // disabled buttons don't fire click, but confirm no throw either way
    expect(micBtn).not.toHaveClass("listening");
  });

  it("uses en-US for the default English UI language, not en-IN (root cause of silent zero-result transcription on real hardware)", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    await user.click(screen.getByTitle("Speak your question"));
    expect(MockSpeechRecognition.instances[0].lang).toBe("en-US");
  });

  it("uses the locale-specific tag for a non-English UI language", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="hi" context={CONTEXT} />);
    await user.click(screen.getByTitle("Speak your question"));
    expect(MockSpeechRecognition.instances[0].lang).toBe("hi-IN");
  });

  it("interim results update the input live without duplicating text on each subsequent onresult call", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    await user.click(screen.getByTitle("Speak your question"));
    const recog = MockSpeechRecognition.instances[0];
    const input = document.querySelector(".chat-input");

    act(() => {
      recog.onresult({ results: [[{ transcript: "what" }]] });
    });
    expect(input.value).toBe("what");

    act(() => {
      recog.onresult({ results: [[{ transcript: "what rooms" }]] });
    });
    expect(input.value).toBe("what rooms"); // replaced, not appended onto the previous partial

    act(() => {
      recog.onresult({ results: [[{ transcript: "what rooms does my policy cover", isFinal: true }]] });
    });
    expect(input.value).toBe("what rooms does my policy cover");
  });

  it("mic output appends to text the user had already typed, rather than overwriting it", async () => {
    window.SpeechRecognition = MockSpeechRecognition;
    const user = userEvent.setup();
    render(<AskConfluence mode="navigator" lang="en" context={CONTEXT} />);
    const input = document.querySelector(".chat-input");
    await user.type(input, "regarding my mother, ");
    await user.click(screen.getByTitle("Speak your question"));

    act(() => {
      MockSpeechRecognition.instances[0].onresult({ results: [[{ transcript: "what rooms are covered" }]] });
    });
    expect(input.value).toBe("regarding my mother,  what rooms are covered");
  });
});
