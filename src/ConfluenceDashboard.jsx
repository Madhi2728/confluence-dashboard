import React, { useState, useMemo } from "react";
import { Activity, ShieldCheck, BedDouble, Clock, ChevronDown, SlidersHorizontal, Sparkles, ArrowRight, Zap, RotateCcw, IndianRupee, Timer, Users2 } from "lucide-react";

const BASE_PATIENTS = [
  { id: "P-104", name: "R. Sharma", age: 62, sex: "M", condition: "Acute Myocardial Infarction", clinicalRisk: 92, scheme: "Ayushman Bharat (PM-JAY)", policyMatch: 88, bed: "Cardiac ICU", resourceFit: 40, wait: "6 min", estSavings: 185000, timeSavedMin: 34 },
  { id: "P-211", name: "A. Fatima", age: 29, sex: "F", condition: "High-Risk Pregnancy, 34wk", clinicalRisk: 78, scheme: "Janani Suraksha Yojana", policyMatch: 92, bed: "Maternity ICU", resourceFit: 25, wait: "10 min", estSavings: 42000, timeSavedMin: 22 },
  { id: "P-098", name: "T. Joshi", age: 5, sex: "M", condition: "Febrile Seizure", clinicalRisk: 70, scheme: "CGHS", policyMatch: 90, bed: "Pediatric ICU", resourceFit: 20, wait: "8 min", estSavings: 15000, timeSavedMin: 26 },
  { id: "P-176", name: "M. Reddy", age: 71, sex: "M", condition: "Acute Renal Failure", clinicalRisk: 85, scheme: "Ayushman Bharat (PM-JAY)", policyMatch: 60, bed: "Dialysis Unit", resourceFit: 35, wait: "15 min", estSavings: 96000, timeSavedMin: 19 },
  { id: "P-233", name: "S. Iyer", age: 8, sex: "F", condition: "Severe Pneumonia", clinicalRisk: 68, scheme: "CGHS", policyMatch: 95, bed: "Pediatric Ward", resourceFit: 80, wait: "22 min", estSavings: 8000, timeSavedMin: 8 },
  { id: "P-150", name: "P. Nair", age: 58, sex: "F", condition: "Oncology — Chemo Cycle 3", clinicalRisk: 60, scheme: "State Health Scheme", policyMatch: 45, bed: "Day-Care Oncology", resourceFit: 50, wait: "35 min", estSavings: 54000, timeSavedMin: 5 },
  { id: "P-087", name: "D. Singh", age: 34, sex: "M", condition: "Post-Op Ortho Trauma", clinicalRisk: 52, scheme: "ESIC", policyMatch: 70, bed: "Ortho Ward", resourceFit: 65, wait: "40 min", estSavings: 21000, timeSavedMin: 4 },
  { id: "P-192", name: "K. Verma", age: 45, sex: "M", condition: "Diabetic Foot Ulcer", clinicalRisk: 40, scheme: "MediClaim+ (Private)", policyMatch: 55, bed: "General Ward", resourceFit: 90, wait: "1 hr 10 min", estSavings: 3000, timeSavedMin: 2 },
];

const EVENT_PATIENT_POOL = [
  { name: "Incoming Trauma Case", age: 47, sex: "M", condition: "Multi-Trauma (RTA)", clinicalRisk: 96, scheme: "Ayushman Bharat (PM-JAY)", policyMatch: 82, bed: "Trauma ICU", resourceFit: 30, wait: "Just arrived", estSavings: 150000, timeSavedMin: 30 },
  { name: "Incoming Cardiac Case", age: 55, sex: "F", condition: "Unstable Angina", clinicalRisk: 89, scheme: "CGHS", policyMatch: 87, bed: "Cardiac ICU", resourceFit: 28, wait: "Just arrived", estSavings: 132000, timeSavedMin: 27 },
];

const priorityOf = (risk) => (risk >= 75 ? "critical" : risk >= 45 ? "moderate" : "stable");
const priorityColor = { critical: "var(--critical)", moderate: "var(--moderate)", stable: "var(--stable)" };
const priorityLabel = { critical: "Critical", moderate: "Moderate", stable: "Stable" };

function rationale(p, w) {
  const factors = [
    { k: "clinical", v: p.clinicalRisk, w: w.clinical, text: `elevated clinical risk (${p.clinicalRisk})` },
    { k: "policy", v: p.policyMatch, w: w.policy, text: `strong ${p.scheme} eligibility (${p.policyMatch}% match)` },
    { k: "resource", v: p.resourceFit, w: w.resource, text: `${p.bed} capacity fit (${p.resourceFit}%)` },
  ];
  const top = [...factors].sort((a, b) => b.v * b.w - a.v * a.w)[0];
  return `Driven primarily by ${top.text}.`;
}

function formatRupees(n) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

export default function ConfluenceDashboard() {
  const [weights, setWeights] = useState({ clinical: 45, policy: 30, resource: 25 });
  const [expandedId, setExpandedId] = useState("P-104");
  const [filter, setFilter] = useState("all");

  // --- Add-on: live event simulation state ---
  const [injected, setInjected] = useState([]);
  const [resourceBoosts, setResourceBoosts] = useState({});
  const [bedsFree, setBedsFree] = useState(14);
  const [eventLog, setEventLog] = useState([]);
  const [pulsing, setPulsing] = useState(false);
  const injectedCounter = React.useRef(0);

  const totalW = weights.clinical + weights.policy + weights.resource;

  const allPatients = useMemo(() => [...BASE_PATIENTS, ...injected], [injected]);

  const patients = useMemo(() => {
    return allPatients
      .map((p) => {
        const boostedResource = Math.min(100, p.resourceFit + (resourceBoosts[p.id] || 0));
        const score = Math.round(
          (p.clinicalRisk * weights.clinical + p.policyMatch * weights.policy + boostedResource * weights.resource) / totalW
        );
        return { ...p, resourceFit: boostedResource, score, priority: priorityOf(p.clinicalRisk) };
      })
      .sort((a, b) => b.score - a.score);
  }, [allPatients, weights, resourceBoosts]);

  const visible = filter === "all" ? patients : patients.filter((p) => p.priority === filter);

  const avgPolicyMatch = Math.round(allPatients.reduce((s, p) => s + p.policyMatch, 0) / allPatients.length);
  const criticalCount = allPatients.filter((p) => priorityOf(p.clinicalRisk) === "critical").length;

  // --- Add-on: impact/outcome counter, derived from mock savings + time-saved fields ---
  const totalCostSaved = allPatients.reduce((s, p) => s + p.estSavings, 0);
  const totalTimeSavedMin = allPatients.reduce((s, p) => s + p.timeSavedMin, 0);
  const optimallyMatchedCount = allPatients.filter((p) => p.policyMatch >= 70).length;

  const setW = (key, val) => setWeights((prev) => ({ ...prev, [key]: val }));

  const triggerPulse = () => {
    setPulsing(true);
    setTimeout(() => setPulsing(false), 900);
  };

  const addLog = (text) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setEventLog((prev) => [{ time, text }, ...prev].slice(0, 6));
  };

  const simulateCriticalArrival = () => {
    const template = EVENT_PATIENT_POOL[injectedCounter.current % EVENT_PATIENT_POOL.length];
    injectedCounter.current += 1;
    const newPatient = { ...template, id: `P-3${String(injectedCounter.current).padStart(2, "0")}` };
    setInjected((prev) => [...prev, newPatient]);
    addLog(`New critical patient ${newPatient.id} entered the queue — ${newPatient.condition}. Queue re-optimized.`);
    triggerPulse();
  };

  const simulateBedFreed = () => {
    setBedsFree((prev) => prev + 1);
    setResourceBoosts((prev) => {
      const next = { ...prev };
      allPatients.forEach((p) => {
        if (p.bed.toLowerCase().includes("icu")) {
          next[p.id] = Math.min(60, (next[p.id] || 0) + 15);
        }
      });
      return next;
    });
    addLog(`ICU bed freed — resource fit recalculated for ICU-bound patients. Queue re-optimized.`);
    triggerPulse();
  };

  const resetSimulation = () => {
    setInjected([]);
    setResourceBoosts({});
    setBedsFree(14);
    setEventLog([]);
    injectedCounter.current = 0;
  };

  return (
    <div className="confluence-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .confluence-root {
          --bg: #0a0f16;
          --panel: #121b27;
          --panel2: #16202d;
          --border: #223247;
          --text: #e9f1f8;
          --muted: #7f92a8;
          --critical: #f0555f;
          --moderate: #f5a623;
          --stable: #35d28a;
          --clinical: #4fc9e0;
          --policy: #3e8ef7;
          --resource: #9b7bff;
          --gold: #f0b429;
          font-family: 'IBM Plex Sans', sans-serif;
          background: var(--bg);
          color: var(--text);
          padding: 28px;
          border-radius: 16px;
          min-height: 100%;
          background-image:
            radial-gradient(circle at 100% 0%, rgba(62,142,247,0.08), transparent 40%),
            radial-gradient(circle at 0% 100%, rgba(155,123,255,0.06), transparent 40%);
        }
        .confluence-root * { box-sizing: border-box; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .display { font-family: 'Space Grotesk', sans-serif; }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          padding-bottom: 22px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 22px;
          flex-wrap: wrap;
        }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-mark {
          width: 38px; height: 38px; border-radius: 10px;
          background: linear-gradient(135deg, var(--clinical), var(--policy), var(--resource));
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .title { font-size: 22px; font-weight: 700; letter-spacing: 0.3px; }
        .subtitle { color: var(--muted); font-size: 12.5px; margin-top: 2px; }

        .stats { display: flex; gap: 10px; flex-wrap: wrap; }
        .stat {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 8px 14px;
          min-width: 100px;
        }
        .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
        .stat-value { font-size: 17px; font-weight: 600; margin-top: 2px; }

        .layout { display: grid; grid-template-columns: 240px 1fr; gap: 20px; }
        @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }

        .sidebar {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 18px;
          align-self: start;
        }
        .sidebar-title {
          display: flex; align-items: center; gap: 7px;
          font-size: 12.5px; font-weight: 600; color: var(--text);
          margin-bottom: 4px;
        }
        .sidebar-sub { font-size: 11px; color: var(--muted); margin-bottom: 16px; }

        .weight-row { margin-bottom: 16px; }
        .weight-label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
        .weight-name { display: flex; align-items: center; gap: 6px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; }
        input[type="range"] {
          width: 100%; accent-color: var(--policy); height: 4px;
        }

        .filters { display: flex; gap: 6px; margin-top: 18px; flex-wrap: wrap; }
        .filter-btn {
          background: var(--panel2); border: 1px solid var(--border); color: var(--muted);
          font-size: 11px; padding: 5px 10px; border-radius: 20px; cursor: pointer;
          font-family: inherit;
        }
        .filter-btn.active { color: var(--bg); background: var(--text); border-color: var(--text); font-weight: 600; }

        .queue { display: flex; flex-direction: column; gap: 10px; }
        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          transition: border-color 0.2s ease;
        }
        .card.expanded { border-color: rgba(62,142,247,0.4); }
        .card-head {
          display: grid;
          grid-template-columns: auto 1fr auto auto auto auto;
          align-items: center;
          gap: 16px;
          padding: 14px 16px;
          cursor: pointer;
        }
        @media (max-width: 700px) { .card-head { grid-template-columns: auto 1fr auto; row-gap: 8px; } .hide-sm { display: none; } }

        .rank { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); width: 22px; }
        .who { display: flex; flex-direction: column; }
        .who-name { font-weight: 600; font-size: 14px; }
        .who-meta { font-size: 11.5px; color: var(--muted); margin-top: 1px; }

        .badge {
          font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 20px;
          border: 1px solid; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.4px;
        }

        .metric { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
        .metric b { color: var(--text); font-family: 'IBM Plex Mono', monospace; font-weight: 600; }

        .score-ring {
          width: 44px; height: 44px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 13px;
          flex-shrink: 0;
        }

        .chev { color: var(--muted); transition: transform 0.2s ease; }
        .chev.open { transform: rotate(180deg); }

        .trace {
          padding: 4px 16px 22px 16px;
          border-top: 1px solid var(--border);
          background: var(--panel2);
        }
        .trace-svg-wrap { width: 100%; overflow-x: auto; }
        .rec-box {
          margin-top: 6px;
          background: rgba(240,180,41,0.07);
          border: 1px solid rgba(240,180,41,0.35);
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rec-box .icon { color: var(--gold); flex-shrink: 0; }
        .rec-title { font-size: 12.5px; font-weight: 600; color: var(--gold); }
        .rec-text { font-size: 12px; color: var(--muted); margin-top: 2px; }

        .legend { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
        .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }

        .impact-banner { display: flex; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
        .impact-card {
          flex: 1; min-width: 170px;
          background: linear-gradient(135deg, rgba(240,180,41,0.08), rgba(240,180,41,0.02));
          border: 1px solid rgba(240,180,41,0.35);
          border-radius: 12px;
          padding: 14px 16px;
        }
        .impact-label {
          font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px;
          color: var(--muted); display: flex; align-items: center; gap: 6px;
        }
        .impact-value {
          font-size: 22px; font-weight: 700; color: var(--gold); margin-top: 6px;
          font-family: 'IBM Plex Mono', monospace;
        }
        .impact-sub { font-size: 10.5px; color: var(--muted); margin-top: 3px; }

        .events-block { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
        .reopt-tag {
          margin-left: auto; font-size: 10px; font-weight: 600; color: var(--policy);
          background: rgba(62,142,247,0.12); padding: 2px 8px; border-radius: 20px;
        }
        .events-block .sidebar-title { justify-content: flex-start; }

        .event-btn {
          width: 100%; background: var(--panel2); border: 1px solid var(--border); color: var(--text);
          font-size: 11.5px; padding: 9px 11px; border-radius: 8px; cursor: pointer;
          margin-bottom: 8px; text-align: left; display: flex; align-items: center; gap: 8px;
          font-family: inherit; transition: border-color 0.15s ease;
        }
        .event-btn:hover { border-color: var(--policy); }
        .event-btn.reset { color: var(--muted); }

        .event-log { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; max-height: 160px; overflow-y: auto; }
        .event-log-item { font-size: 10.5px; color: var(--muted); line-height: 1.4; }
        .event-log-time {
          font-family: 'IBM Plex Mono', monospace; color: var(--stable);
          margin-right: 6px; white-space: nowrap;
        }

        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(62,142,247,0); }
          40% { box-shadow: 0 0 0 3px rgba(62,142,247,0.3); }
          100% { box-shadow: 0 0 0 0 rgba(62,142,247,0); }
        }
        .queue.pulsing .card { animation: pulseGlow 0.9s ease; }
      `}</style>

      <div className="header">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} color="#0a0f16" />
          </div>
          <div>
            <div className="title display">CONFLUENCE</div>
            <div className="subtitle">Policy-Integrated Admission &amp; Treatment Intelligence — live queue</div>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Beds Free</div>
            <div className="stat-value mono">{bedsFree}</div>
          </div>
          <div className="stat">
            <div className="stat-label">In Queue</div>
            <div className="stat-value mono">{allPatients.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Critical</div>
            <div className="stat-value mono" style={{ color: "var(--critical)" }}>{criticalCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Avg Policy Match</div>
            <div className="stat-value mono">{avgPolicyMatch}%</div>
          </div>
        </div>
      </div>

      <div className="impact-banner">
        <div className="impact-card">
          <div className="impact-label"><IndianRupee size={12} /> Est. Cost Saved</div>
          <div className="impact-value">{formatRupees(totalCostSaved)}</div>
          <div className="impact-sub">via optimal scheme matching, this session</div>
        </div>
        <div className="impact-card">
          <div className="impact-label"><Timer size={12} /> Wait Time Reduced</div>
          <div className="impact-value">{(totalTimeSavedMin / 60).toFixed(1)} hrs</div>
          <div className="impact-sub">vs. a first-come-first-served queue</div>
        </div>
        <div className="impact-card">
          <div className="impact-label"><Users2 size={12} /> Optimally Matched</div>
          <div className="impact-value">{optimallyMatchedCount}/{allPatients.length}</div>
          <div className="impact-sub">patients at ≥70% policy eligibility</div>
        </div>
      </div>

      <div className="layout">
        <div className="sidebar">
          <div className="sidebar-title"><SlidersHorizontal size={14} /> Optimization Weights</div>
          <div className="sidebar-sub">Re-ranks the queue live across all three layers.</div>

          <div className="weight-row">
            <div className="weight-label">
              <span className="weight-name"><span className="dot" style={{ background: "var(--clinical)" }} /> Clinical</span>
              <span className="mono">{weights.clinical}</span>
            </div>
            <input type="range" min="5" max="80" value={weights.clinical} onChange={(e) => setW("clinical", +e.target.value)} />
          </div>
          <div className="weight-row">
            <div className="weight-label">
              <span className="weight-name"><span className="dot" style={{ background: "var(--policy)" }} /> Policy</span>
              <span className="mono">{weights.policy}</span>
            </div>
            <input type="range" min="5" max="80" value={weights.policy} onChange={(e) => setW("policy", +e.target.value)} />
          </div>
          <div className="weight-row">
            <div className="weight-label">
              <span className="weight-name"><span className="dot" style={{ background: "var(--resource)" }} /> Resource</span>
              <span className="mono">{weights.resource}</span>
            </div>
            <input type="range" min="5" max="80" value={weights.resource} onChange={(e) => setW("resource", +e.target.value)} />
          </div>

          <div className="filters">
            {["all", "critical", "moderate", "stable"].map((f) => (
              <button key={f} className={"filter-btn" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : priorityLabel[f]}
              </button>
            ))}
          </div>

          <div className="events-block">
            <div className="sidebar-title">
              <Activity size={14} /> Live Events
              {pulsing && <span className="reopt-tag">Re-optimizing…</span>}
            </div>
            <div className="sidebar-sub">Simulate real-time changes to the queue.</div>

            <button className="event-btn" onClick={simulateCriticalArrival}>
              <Zap size={13} color="var(--critical)" /> Critical patient arrives
            </button>
            <button className="event-btn" onClick={simulateBedFreed}>
              <BedDouble size={13} color="var(--stable)" /> ICU bed freed
            </button>
            <button className="event-btn reset" onClick={resetSimulation}>
              <RotateCcw size={13} /> Reset simulation
            </button>

            {eventLog.length > 0 && (
              <div className="event-log">
                {eventLog.map((e, idx) => (
                  <div className="event-log-item" key={idx}>
                    <span className="event-log-time">{e.time}</span>
                    <span>{e.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={"queue" + (pulsing ? " pulsing" : "")}>
          {visible.map((p, i) => {
            const isOpen = expandedId === p.id;
            const pc = priorityColor[p.priority];
            return (
              <div key={p.id} className={"card" + (isOpen ? " expanded" : "")}>
                <div className="card-head" onClick={() => setExpandedId(isOpen ? null : p.id)}>
                  <span className="rank mono">{String(i + 1).padStart(2, "0")}</span>
                  <div className="who">
                    <span className="who-name">{p.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {p.age}{p.sex}</span></span>
                    <span className="who-meta">{p.condition} · {p.id}</span>
                  </div>
                  <span className="badge hide-sm" style={{ color: pc, borderColor: pc, background: `color-mix(in srgb, ${pc} 12%, transparent)` }}>
                    {priorityLabel[p.priority]}
                  </span>
                  <span className="metric hide-sm"><Clock size={13} /> <b>{p.wait}</b></span>
                  <span className="metric hide-sm"><BedDouble size={13} /> <b>{p.bed}</b></span>
                  <div className="score-ring" style={{ background: `conic-gradient(var(--gold) ${p.score * 3.6}deg, var(--panel2) 0deg)` }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {p.score}
                    </div>
                  </div>
                  <ChevronDown size={16} className={"chev" + (isOpen ? " open" : "")} />
                </div>

                {isOpen && (
                  <div className="trace">
                    <div className="trace-svg-wrap">
                      <svg viewBox="0 0 620 150" width="100%" style={{ minWidth: 480 }}>
                        <path d="M120,26 C340,26 340,75 560,75" fill="none" stroke="var(--clinical)" strokeWidth="2" opacity="0.8" />
                        <path d="M120,75 L560,75" fill="none" stroke="var(--policy)" strokeWidth="2" opacity="0.8" />
                        <path d="M120,124 C340,124 340,75 560,75" fill="none" stroke="var(--resource)" strokeWidth="2" opacity="0.8" />

                        <circle cx="112" cy="26" r="7" fill="var(--clinical)" />
                        <circle cx="112" cy="75" r="7" fill="var(--policy)" />
                        <circle cx="112" cy="124" r="7" fill="var(--resource)" />
                        <circle cx="560" cy="75" r="10" fill="var(--gold)" />

                        <text x="0" y="16" fill="var(--muted)" fontSize="10" fontFamily="IBM Plex Mono, monospace">CLINICAL RISK</text>
                        <text x="0" y="34" fill="var(--clinical)" fontSize="16" fontWeight="600" fontFamily="IBM Plex Mono, monospace">{p.clinicalRisk}</text>

                        <text x="0" y="65" fill="var(--muted)" fontSize="10" fontFamily="IBM Plex Mono, monospace">POLICY MATCH · {p.scheme.length > 22 ? p.scheme.slice(0,22)+"…" : p.scheme}</text>
                        <text x="0" y="83" fill="var(--policy)" fontSize="16" fontWeight="600" fontFamily="IBM Plex Mono, monospace">{p.policyMatch}%</text>

                        <text x="0" y="114" fill="var(--muted)" fontSize="10" fontFamily="IBM Plex Mono, monospace">RESOURCE FIT · {p.bed}</text>
                        <text x="0" y="132" fill="var(--resource)" fontSize="16" fontWeight="600" fontFamily="IBM Plex Mono, monospace">{p.resourceFit}%</text>

                        <text x="578" y="65" fill="var(--gold)" fontSize="10" fontFamily="IBM Plex Mono, monospace">SCORE</text>
                        <text x="578" y="90" fill="var(--gold)" fontSize="18" fontWeight="700" fontFamily="IBM Plex Mono, monospace">{p.score}</text>
                      </svg>
                    </div>

                    <div className="rec-box">
                      <ArrowRight size={18} className="icon" />
                      <div>
                        <div className="rec-title">Recommended: Admit → {p.bed}</div>
                        <div className="rec-text">
                          Eligible under {p.scheme} at {p.policyMatch}% coverage match. {rationale(p, weights)}
                        </div>
                      </div>
                    </div>

                    <div className="legend">
                      <span className="legend-item"><span className="dot" style={{ background: "var(--clinical)" }} /> Clinical layer</span>
                      <span className="legend-item"><span className="dot" style={{ background: "var(--policy)" }} /> Policy layer</span>
                      <span className="legend-item"><span className="dot" style={{ background: "var(--resource)" }} /> Resource layer</span>
                      <span className="legend-item"><ShieldCheck size={12} /> Explainable at every node</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
