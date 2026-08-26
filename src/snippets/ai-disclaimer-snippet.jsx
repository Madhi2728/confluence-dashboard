{/* ==========================================================
   Confluence Chatbot — AI Disclaimer Snippet
   Paste this INSIDE your chat panel JSX, right after the
   input box / send button (as a sibling AFTER the scrollable
   messages div, not inside it).
   ========================================================== */}

<p className="text-[11px] text-gray-400 text-center italic mt-1.5">
  Confluence is an AI & can make mistakes. Please double check responses.
</p>

{/* ----------------------------------------------------------
   If you're NOT using Tailwind, use this inline-style version
   instead of the className version above:
   ---------------------------------------------------------- */}

<p style={{
  fontSize: '11px',
  color: '#9CA3AF',
  textAlign: 'center',
  margin: '6px 0 0',
  fontStyle: 'italic'
}}>
  Confluence is an AI & can make mistakes. Please double check responses.
</p>
