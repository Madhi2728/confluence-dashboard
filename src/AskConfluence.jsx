import React, { useMemo, useRef, useState } from "react";
import { MessageCircle, Send, ShieldAlert, Mic, Volume2, Paperclip } from "lucide-react";

// --- Voice assistant locale mapping (browser Web Speech API, no external service) ---
const SPEECH_LOCALES = { en: "en-IN", hi: "hi-IN", ta: "ta-IN", kn: "kn-IN", te: "te-IN" };

// --- Guardrails — enforce the competition brief's explicit boundary:
// "must not provide medical diagnoses, clinical treatment recommendations, or binding insurance advice."
// Checked client-side, before the message ever reaches the Groq call, so it can never be bypassed by
// a cleverly-phrased question or a change on the server side -- this is a hard client-side floor, not
// just a system-prompt instruction the model could in principle ignore. ---
const GUARDRAIL_PATTERNS = [
  {
    category: "diagnosis",
    pattern: /diagnos|what.?s wrong with (me|him|her|the patient)|do (i|they|we) have (a |an )?\w+|is (this|it) serious|what disease|what condition does|interpret (the|these) (scan|result|report)/i,
    reply:
      "I can't provide or interpret a medical diagnosis — that needs a clinician who can examine the patient. What I can do is explain what the insurance covers once a diagnosis or treatment plan is recorded.",
  },
  {
    category: "treatment",
    pattern: /should (i|they|we|the patient) (take|do|get|have|start)|which (medicine|drug|treatment|dose)|prescrib|dosage|treatment for|cure for|is surgery (needed|necessary)|recommend (a |the )?(treatment|procedure|drug)/i,
    reply:
      "I can't recommend a clinical treatment, procedure, or medication — that decision belongs to the care team. Once a treatment is decided, I can tell you how the policy covers it.",
  },
  {
    category: "binding",
    pattern: /guarantee|100% (sure|certain|covered|approved)|promise|definitely (covered|approved)|for sure (covered|approved)|will (definitely|certainly) (cover|approve|pay)|is my claim (approved|guaranteed)/i,
    reply:
      "I can't guarantee a specific insurance outcome — final approval always rests with the insurer's review of the claim. I can tell you what's typically expected under the policy, but please confirm the final decision with the insurer directly.",
  },
];

function checkGuardrails(text) {
  for (const g of GUARDRAIL_PATTERNS) {
    if (g.pattern.test(text)) return { text: g.reply, flagged: true, category: g.category };
  }
  return null;
}

const MODE_CONFIG = {
  navigator: {
    defaults: {
      title: "Ask Confluence",
      placeholder: "Ask about coverage, rooms, or next steps…",
      send: "Send",
      intro: "Ask me anything about your coverage, hospitals, or care journey.",
    },
    suggestions: [
      "What rooms does my policy cover?",
      "Which hospitals are in-network?",
      "What will this cost me?",
      "What does my policy exclude?",
      "Is this cashless or reimbursement?",
      "What does my current stage mean?",
    ],
  },
};

// Calls the Groq-backed /api/chat-confluence endpoint. Kept as a standalone
// function (not inline in submit()) so the request shape is easy to see and
// test in isolation.
async function askConfluenceApi({ message, history, context }) {
  const response = await fetch("/api/chat-confluence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, context }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.ok) {
    throw new Error(payload?.error || `Assistant request failed (HTTP ${response.status}).`);
  }
  return payload.reply;
}

export default function AskConfluence({ mode = "navigator", lang = "en", context, labels }) {
  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.navigator;
  const text = { ...cfg.defaults, ...(labels || {}) };

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const recognitionRef = useRef(null);

  // context/messages can change every render (parent recomputes the selected
  // patient's policy/hospitals) — keep refs so the async submit() below
  // always reads the latest values, not whatever was current when it started.
  const contextRef = useRef(context);
  contextRef.current = context;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const submit = async (raw) => {
    if (typing) return; // client-side throttle: no overlapping/rapid-fire submissions
    const question = (raw ?? input).trim();
    if (!question && !attachment) return;

    const sentAttachment = attachment;
    setMessages((prev) => [...prev, { role: "user", text: question, attachment: sentAttachment }]);
    setInput("");
    setAttachment(null);

    if (sentAttachment && !question) {
      // No text to answer and this preview can't read document contents --
      // same as before, this is a fixed local reply, not a Groq call.
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `I can see "${sentAttachment.name}" is attached, but I can't read document contents in this preview. Ask a specific question and I'll answer from the policy on file.`,
          flagged: false,
        },
      ]);
      return;
    }

    const guard = checkGuardrails(question);
    if (guard) {
      setMessages((prev) => [...prev, { role: "assistant", text: guard.text, flagged: true }]);
      return;
    }

    setTyping(true);
    const outgoingMessage = sentAttachment
      ? `${question}\n\n[The user also attached a file named "${sentAttachment.name}" — you cannot see its contents; answer only the text question above.]`
      : question;
    const history = messagesRef.current
      .filter((m) => !m.flagged) // don't feed the model its own guardrail refusals as prior turns
      .map((m) => ({ role: m.role, text: m.text }));

    try {
      const reply = await askConfluenceApi({ message: outgoingMessage, history, context: contextRef.current });
      setMessages((prev) => [...prev, { role: "assistant", text: reply, flagged: false }]);
    } catch (err) {
      console.error("Ask Confluence: chat request failed:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Sorry, I couldn't reach the assistant just now. Please try again in a moment.",
          flagged: false,
          error: true,
        },
      ]);
    } finally {
      setTyping(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") submit();
  };

  const onAttach = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setAttachment({ name: file.name, size: file.size });
    e.target.value = "";
  };

  // --- Voice input (browser Web Speech API, no external service/key) ---
  const speechSupported =
    typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleListening = () => {
    if (!speechSupported) return;
    if (listening) {
      recognitionRef.current && recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new Ctor();
    recog.lang = SPEECH_LOCALES[lang] || "en-IN";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
    };
    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);
    recognitionRef.current = recog;
    setListening(true);
    recog.start();
  };

  // --- Text-to-speech playback of assistant replies ---
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const toggleSpeak = (index, value) => {
    if (!ttsSupported) return;
    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(value);
    utter.lang = SPEECH_LOCALES[lang] || "en-IN";
    utter.onend = () => setSpeakingIndex(null);
    utter.onerror = () => setSpeakingIndex(null);
    setSpeakingIndex(index);
    window.speechSynthesis.speak(utter);
  };

  const suggestions = useMemo(() => cfg.suggestions, [cfg]);

  return (
    <div className="panel-like chat-panel">
      <div className="sidebar-title">
        <MessageCircle size={14} /> {text.title}
        <span className="guardrail-badge">
          <ShieldAlert size={11} /> No diagnosis · No binding advice
        </span>
      </div>

      <div className="chat-window">
        {messages.length === 0 && <div className="chat-intro">{text.intro}</div>}
        {messages.map((m, i) => (
          <div key={i} className={"chat-bubble " + m.role + (m.flagged ? " flagged" : "") + (m.error ? " error" : "")}>
            {m.flagged && (
              <div className="flagged-label">
                <ShieldAlert size={11} /> Outside decision-support scope
              </div>
            )}
            {m.attachment && (
              <div className="chat-file-chip">
                <Paperclip size={11} /> {m.attachment.name}
              </div>
            )}
            {m.text}
            {m.role === "assistant" && !m.error && ttsSupported && (
              <button type="button" className="chat-speak-btn" onClick={() => toggleSpeak(i, m.text)} title="Listen">
                <Volume2 size={12} color={speakingIndex === i ? "var(--policy)" : undefined} />
              </button>
            )}
          </div>
        ))}
        {typing && <div className="chat-bubble assistant typing">···</div>}
      </div>

      {messages.length === 0 && (
        <div className="chat-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chat-suggestion" onClick={() => submit(s)} disabled={typing}>
              {s}
            </button>
          ))}
        </div>
      )}

      {attachment && (
        <div className="chat-attachment-preview">
          <Paperclip size={12} /> {attachment.name}
          <button type="button" className="chat-attachment-remove" onClick={() => setAttachment(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="chat-input-row">
        <label className="chat-icon-btn" title="Attach a file">
          <Paperclip size={15} />
          <input type="file" accept="image/*,.pdf,.doc,.docx" onChange={onAttach} hidden />
        </label>
        {speechSupported && (
          <button
            className={"chat-icon-btn" + (listening ? " listening" : "")}
            onClick={toggleListening}
            title={listening ? "Stop listening" : "Speak your question"}
            type="button"
          >
            <Mic size={15} />
          </button>
        )}
        <input
          className="chat-input"
          type="text"
          placeholder={listening ? "Listening…" : text.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={typing}
        />
        <button type="button" className="chat-send-btn" onClick={() => submit()} disabled={typing}>
          <Send size={14} /> {text.send}
        </button>
      </div>
    </div>
  );
}
