import React, { useMemo, useRef, useState } from "react";
import { MessageCircle, Send, ShieldAlert, Mic, Volume2, Paperclip } from "lucide-react";
import { formatRupees } from "./format.js";

// --- Voice assistant locale mapping (browser Web Speech API, no external service) ---
const SPEECH_LOCALES = { en: "en-IN", hi: "hi-IN", ta: "ta-IN", kn: "kn-IN", te: "te-IN" };

// --- Guardrails — enforce the competition brief's explicit boundary:
// "must not provide medical diagnoses, clinical treatment recommendations, or binding insurance advice."
// Checked before any intent matching so it can never be bypassed by a cleverly-phrased question. ---
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

const includesAny = (haystack, needles) => needles.some((n) => haystack.includes(n));

// ---------------------------------------------------------------------------
// NAVIGATOR intents — caregiver-facing, grounded in the selected patient's
// live policy object, matched hospitals and current care-journey stage.
// ---------------------------------------------------------------------------
const NAVIGATOR_INTENTS = [
  {
    id: "rooms",
    keywords: ["room", "co-pay", "copay", "co pay", "private", "deluxe", "upgrade", "ward", "semi-private", "semi private", "bed type"],
    build: (ctx) => {
      const { profile, stage } = ctx;
      const covered = profile.roomEligibility.length ? profile.roomEligibility.join(" and ") : "no room categories on record";
      const transfer = stage.alternatives.find((a) => /co-?pay|upgrade|private/i.test(a.title + a.detail));
      const extra = transfer ? ` For example — ${transfer.title}: ${transfer.detail}` : "";
      return `Your policy (${profile.insurer}) covers ${covered}. A room outside that list — Private or Deluxe — is normally a daily co-pay you settle yourself, not the insurer.${extra}`;
    },
  },
  {
    id: "network",
    keywords: ["in-network", "in network", "network", "which hospital", "hospitals", "where can i go", "out-of-network", "out of network", "empanel", "listed hospital"],
    build: (ctx) => {
      const { hospitals } = ctx;
      const inNet = hospitals.filter((h) => h.network === "In-Network");
      const outNet = hospitals.filter((h) => h.network !== "In-Network");
      const inLine = inNet.length
        ? `In-network (cashless expected): ${inNet.map((h) => `${h.name} (~${formatRupees(h.indicativeCost)})`).join(", ")}.`
        : "No in-network hospitals are currently listed.";
      const outLine = outNet.length
        ? ` Out-of-network (reimbursement route): ${outNet.map((h) => h.name).join(", ")}.`
        : "";
      return `${inLine}${outLine}`;
    },
  },
  {
    id: "cost",
    keywords: ["cost", "price", "how much", "expensive", "afford", "coverage limit", "limit", "estimate", "budget", "out of pocket", "out-of-pocket", "total"],
    build: (ctx) => {
      const { profile, hospitals } = ctx;
      const costs = hospitals.map((h) => h.indicativeCost);
      const cheapest = [...hospitals].sort((a, b) => a.indicativeCost - b.indicativeCost)[0];
      const highest = Math.max(...costs);
      const headroom = profile.coverageLimit - highest;
      const headroomLine =
        headroom >= 0
          ? `That stays within your ${formatRupees(profile.coverageLimit)} coverage limit.`
          : `The most expensive option is about ${formatRupees(Math.abs(headroom))} over your ${formatRupees(profile.coverageLimit)} coverage limit — the difference would be out-of-pocket.`;
      return `Indicative package costs run from ~${formatRupees(cheapest.indicativeCost)} (${cheapest.name}) up to ~${formatRupees(highest)}. ${headroomLine} Final billing depends on the room chosen and the actual treatment.`;
    },
  },
  {
    id: "exclusions",
    keywords: ["exclu", "not covered", "won't cover", "wont cover", "doesn't cover", "doesnt cover", "excluded", "left out", "what's not covered"],
    build: (ctx) => {
      const { profile } = ctx;
      return profile.exclusions.length
        ? `Your policy explicitly excludes: ${profile.exclusions.join(", ")}. Anything on that list is normally an out-of-pocket expense.`
        : `No specific exclusions are recorded on this policy, but standard scheme rules (cosmetic and elective non-medical items) still apply.`;
    },
  },
  {
    id: "cashless",
    keywords: ["cashless", "reimburs", "claim", "pay upfront", "settlement", "how do i pay", "pay first", "advance"],
    build: (ctx) => {
      const { hospitals } = ctx;
      const inNet = hospitals.filter((h) => h.network === "In-Network").map((h) => h.name);
      const outNet = hospitals.filter((h) => h.network !== "In-Network").map((h) => h.name);
      const a = inNet.length
        ? `Cashless works at in-network hospitals — ${inNet.join(", ")} — where the insurer settles the covered amount directly with the hospital.`
        : `No in-network hospitals are listed right now, so cashless may not be available.`;
      const b = outNet.length
        ? ` At ${outNet.join(", ")} you would pay first and file a reimbursement claim afterwards — keep every original bill and report.`
        : "";
      return `${a}${b}`;
    },
  },
  {
    id: "stage",
    keywords: ["stage", "what does this mean", "care journey", "journey", "current step", "where am i", "what now", "next step", "guidance", "explain this step"],
    build: (ctx) => {
      const { stage, stageIndex, stageCount } = ctx;
      return `You're at step ${stageIndex + 1} of ${stageCount} — "${stage.label}". ${stage.guidance}`;
    },
  },
  {
    id: "alternatives",
    keywords: ["alternative", "option", "other choice", "what are my choices", "instead", "switch", "transfer", "downgrade", "what else can i do"],
    build: (ctx) => {
      const { stage } = ctx;
      const list = stage.alternatives.map((a) => `• ${a.title} — ${a.detail}`).join("\n");
      return `At the "${stage.label}" stage you have these options:\n\n${list}`;
    },
  },
];

function navigatorFallback() {
  return (
    "I didn't quite catch that. I can help with:\n\n" +
    "• room coverage and co-pay\n" +
    "• which hospitals are in-network\n" +
    "• estimated cost against your coverage limit\n" +
    "• what your policy excludes\n" +
    "• cashless vs reimbursement\n" +
    "• what your current care-journey stage means\n" +
    "• the alternatives available at this stage"
  );
}

// ---------------------------------------------------------------------------
// OPS intents — staff-facing, run against the live admission queue.
// ---------------------------------------------------------------------------
function findQueuedPatient(norm, patients) {
  const idMatch = norm.match(/p[-\s]?0*(\d{2,3})/) || norm.match(/\b0*(\d{3})\b/);
  if (idMatch) {
    const digits = idMatch[1];
    const p = patients.find((pt) => pt.id.replace(/\D/g, "").endsWith(digits));
    if (p) return p;
  }
  for (const p of patients) {
    const parts = p.name.toLowerCase().replace(/\./g, "").split(/\s+/);
    if (parts.some((part) => part.length >= 3 && norm.includes(part))) return p;
  }
  const ord = norm.match(/#\s?(\d+)|rank\s?(\d+)|\bno\.?\s?(\d+)|position\s?(\d+)/);
  if (ord) {
    const n = +(ord[1] || ord[2] || ord[3] || ord[4]);
    if (patients[n - 1]) return patients[n - 1];
  }
  if (/\bfirst\b|\btop\b|\bhighest\b/.test(norm)) return patients[0];
  if (/\bsecond\b/.test(norm)) return patients[1];
  if (/\bthird\b/.test(norm)) return patients[2];
  if (/\blast\b|\bbottom\b|\blowest\b/.test(norm)) return patients[patients.length - 1];
  return null;
}

const OPS_INTENTS = [
  {
    id: "outOfNetwork",
    keywords: ["out-of-network", "out of network", "out of the network", "not in network", "not in-network", "oon", "network status", "which are out", "who is out", "who's out", "empanel"],
    build: (ctx) => {
      const { patients } = ctx;
      const out = patients.filter((p) => p.network && p.network !== "In-Network");
      if (!out.length) return "Every patient currently in the queue is in-network — cashless settlement is expected for all of them.";
      return (
        `${out.length} queued ${out.length === 1 ? "patient is" : "patients are"} out-of-network:\n\n` +
        out.map((p) => `• ${p.name} (${p.id}) — ${p.scheme}, ${p.policyMatch}% policy match. Reimbursement route rather than cashless.`).join("\n")
      );
    },
  },
  {
    id: "threshold",
    keywords: ["threshold", "below the", "below policy", "below 70", "under 70", "low match", "poor match", "weak match", "mismatch", "low policy match", "worst match", "match threshold"],
    build: (ctx) => {
      const { patients, threshold } = ctx;
      const below = patients.filter((p) => p.policyMatch < threshold);
      if (!below.length) return `Every queued patient is at or above the ${threshold}% policy-match threshold.`;
      return (
        `${below.length} ${below.length === 1 ? "patient is" : "patients are"} below the ${threshold}% policy-match threshold:\n\n` +
        [...below]
          .sort((a, b) => a.policyMatch - b.policyMatch)
          .map((p) => `• ${p.name} (${p.id}) — ${p.policyMatch}% under ${p.scheme}. Coverage confirmation with the insurer desk is advisable.`)
          .join("\n")
      );
    },
  },
  {
    id: "beds",
    keywords: ["bed", "beds", "free bed", "capacity", "availab", "how many beds", "room free", "vacancy", "space left"],
    build: (ctx) => {
      const { bedsFree, patients } = ctx;
      const critical = patients.filter((p) => p.priority === "critical").length;
      return `${bedsFree} bed${bedsFree === 1 ? "" : "s"} free across the unit right now. ${critical} patient${critical === 1 ? "" : "s"} in the queue ${critical === 1 ? "is" : "are"} flagged critical — bed allocation stays a staff decision.`;
    },
  },
  {
    id: "lastEvent",
    keywords: ["what changed", "last event", "recent", "just happened", "just arrived", "update", "re-optim", "reoptim", "latest", "live event", "after the event"],
    build: (ctx) => {
      const { eventLog, patients } = ctx;
      if (!eventLog || !eventLog.length) {
        return "No live events yet this session. Use the Live Events panel to simulate a critical arrival or a freed bed, then ask again.";
      }
      const last = eventLog[0];
      const leader = patients[0];
      return `Most recent event (${last.time}): ${last.text}\n\nAfter re-optimisation, ${leader.name} (${leader.id}) holds the top of the queue at score ${leader.score}/100.`;
    },
  },
  {
    id: "ranking",
    keywords: ["why", "ranked", "rank", "ranking", "position", "sorted", "score", "breakdown", "explain the queue", "top of the queue", "layer", "weight"],
    build: (ctx, norm) => {
      const { patients, weights, totalW } = ctx;
      const target = findQueuedPatient(norm, patients) || patients[0];
      const rank = patients.findIndex((x) => x.id === target.id) + 1;
      const layers = [
        { name: "Triage Acuity (assigned by clinical staff)", val: target.clinicalRisk, w: weights.clinical },
        { name: "Policy Match", val: target.policyMatch, w: weights.policy },
        { name: "Resource Availability", val: target.resourceFit, w: weights.resource },
      ].map((l) => ({
        ...l,
        wPct: Math.round((l.w / totalW) * 100),
        contrib: +((l.val * l.w) / totalW).toFixed(1),
      }));
      const top = [...layers].sort((a, b) => b.contrib - a.contrib)[0];
      const lines = layers
        .map((l) => `• ${l.name}: ${l.val} × ${l.wPct}% weight = ${l.contrib} pts`)
        .join("\n");
      return (
        `${target.name} (${target.id}) is at rank #${rank} of ${patients.length}, blended score ${target.score}/100.\n\n` +
        `${lines}\n\n` +
        `Largest contribution: the ${top.name} layer at ${top.contrib} pts under the current weight settings ` +
        `(Triage ${layers[0].wPct}% / Policy ${layers[1].wPct}% / Resource ${layers[2].wPct}%). ` +
        `Move the Optimization Weights sliders to see the order change.`
      );
    },
  },
];

function opsFallback(ctx) {
  return (
    "I didn't catch that. On the live queue I can explain:\n\n" +
    "• why a patient is ranked where they are (three-layer weight breakdown)\n" +
    "• which queued patients are out-of-network\n" +
    "• how many beds are free\n" +
    "• what changed after the last live event\n" +
    `• which patients are below the ${ctx.threshold}% policy-match threshold`
  );
}

// ---------------------------------------------------------------------------

const MODE_CONFIG = {
  navigator: {
    intents: NAVIGATOR_INTENTS,
    fallback: navigatorFallback,
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
  ops: {
    intents: OPS_INTENTS,
    fallback: opsFallback,
    defaults: {
      title: "Ask Confluence · Ops",
      placeholder: "Ask about queue ranking, beds, or network status…",
      send: "Send",
      intro: "Ask me about the live admission queue — ranking, capacity, or network status.",
    },
    suggestions: [
      "Why is the top patient ranked first?",
      "Which patients are out-of-network?",
      "How many beds are free?",
      "What changed after the last event?",
      "Who's below the policy-match threshold?",
    ],
  },
};

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

  // context can change every render (parent recomputes queue / policy) — keep a ref
  // so async reply builders always read the latest live state.
  const contextRef = useRef(context);
  contextRef.current = context;

  const respond = (question) => {
    const guard = checkGuardrails(question);
    if (guard) return guard;
    const norm = question.toLowerCase().trim();
    for (const intent of cfg.intents) {
      if (includesAny(norm, intent.keywords)) {
        return { text: intent.build(contextRef.current, norm), flagged: false };
      }
    }
    return { text: cfg.fallback(contextRef.current), flagged: false };
  };

  const submit = (raw) => {
    const question = (raw ?? input).trim();
    if (!question && !attachment) return;
    const sentAttachment = attachment;
    setMessages((prev) => [...prev, { role: "user", text: question, attachment: sentAttachment }]);
    setInput("");
    setAttachment(null);
    setTyping(true);

    setTimeout(() => {
      let reply;
      if (sentAttachment && !question) {
        reply = {
          text: `I can see "${sentAttachment.name}" is attached, but I can't read document contents in this preview. Ask a specific question and I'll answer from the ${mode === "ops" ? "live queue" : "policy on file"}.`,
          flagged: false,
        };
      } else if (sentAttachment && question) {
        const base = respond(question);
        reply = { text: `Regarding "${sentAttachment.name}" — ${base.text}`, flagged: base.flagged };
      } else {
        reply = respond(question);
      }
      setMessages((prev) => [...prev, { role: "assistant", text: reply.text, flagged: reply.flagged }]);
      setTyping(false);
    }, 500);
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
          <div key={i} className={"chat-bubble " + m.role + (m.flagged ? " flagged" : "")}>
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
            {m.role === "assistant" && ttsSupported && (
              <button className="chat-speak-btn" onClick={() => toggleSpeak(i, m.text)} title="Listen">
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
            <button key={s} className="chat-suggestion" onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {attachment && (
        <div className="chat-attachment-preview">
          <Paperclip size={12} /> {attachment.name}
          <button className="chat-attachment-remove" onClick={() => setAttachment(null)}>
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
        />
        <button className="chat-send-btn" onClick={() => submit()}>
          <Send size={14} /> {text.send}
        </button>
      </div>
    </div>
  );
}
