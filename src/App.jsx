import React, { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import ConfluenceDashboard from "./ConfluenceDashboard.jsx";

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ width: "100%", maxWidth: 1100, position: "relative" }}>
      {showSplash && <SplashScreen />}
      <div style={{ opacity: showSplash ? 0 : 1, transition: "opacity 0.6s ease" }}>
        <ConfluenceDashboard />
      </div>
    </div>
  );
}

function SplashScreen() {
  return (
    <div className="splash-overlay">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Sans:wght@400;500&display=swap');

        .splash-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: #0a0f16;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          animation: splashFadeOut 0.6s ease 2.4s forwards;
        }
        .splash-mark {
          width: 60px;
          height: 60px;
          border-radius: 16px;
          background: linear-gradient(135deg, #4fc9e0, #3e8ef7, #9b7bff);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 22px;
          animation: splashPop 0.5s ease;
          box-shadow: 0 0 40px rgba(62,142,247,0.25);
        }
        .splash-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 28px;
          font-weight: 700;
          color: #e9f1f8;
          letter-spacing: 1px;
          opacity: 0;
          animation: splashIn 0.5s ease 0.2s forwards;
        }
        .splash-sub {
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 12.5px;
          color: #7f92a8;
          margin-top: 8px;
          text-align: center;
          opacity: 0;
          animation: splashIn 0.5s ease 0.4s forwards;
        }
        .splash-bar-track {
          width: 200px;
          height: 3px;
          background: #1a2632;
          border-radius: 4px;
          margin-top: 30px;
          overflow: hidden;
        }
        .splash-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #4fc9e0, #3e8ef7, #f0b429);
          width: 0%;
          animation: splashProgress 2.1s ease-out 0.3s forwards;
        }
        @keyframes splashPop {
          from { transform: scale(0.7); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes splashIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashProgress {
          from { width: 0%; }
          to { width: 100%; }
        }
        @keyframes splashFadeOut {
          from { opacity: 1; visibility: visible; }
          to { opacity: 0; visibility: hidden; }
        }
      `}</style>
      <div className="splash-mark">
        <Sparkles size={26} color="#0a0f16" />
      </div>
      <div className="splash-title">CONFLUENCE</div>
      <div className="splash-sub">Policy-Integrated Admission &amp; Treatment Intelligence</div>
      <div className="splash-bar-track">
        <div className="splash-bar-fill" />
      </div>
    </div>
  );
}
