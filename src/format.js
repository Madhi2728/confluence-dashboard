// Shared formatting helpers used by both ConfluenceDashboard and the extracted
// AskConfluence chat component.

export function formatRupees(n) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

// Best-effort inverse of formatRupees, for turning an OCR'd coverage-limit
// string (e.g. "₹5.00L", "Rs. 5,00,000", "5 Lakh", "500000") back into a
// plain rupee number so it flows through the same numeric state (and the
// same formatRupees display) as every other coverage-limit value in the
// app. Returns null -- never a guess -- when the text isn't confidently
// parseable, so callers can treat that the same as a missing field rather
// than silently trusting a wrong number for a coverage decision.
export function parseRupees(text) {
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  if (typeof text !== "string") return null;

  const cleaned = text.trim();
  if (!cleaned) return null;

  const lakhCrore = cleaned.match(/([\d,.]+)\s*(lakh|lac|crore|cr|l)s?\b/i);
  if (lakhCrore) {
    const num = parseFloat(lakhCrore[1].replace(/,/g, ""));
    if (!Number.isFinite(num)) return null;
    const multiplier = lakhCrore[2].toLowerCase().startsWith("cr") ? 1e7 : 1e5;
    return Math.round(num * multiplier);
  }

  const plainMatch = cleaned.match(/\d[\d,]*\.?\d*/);
  if (!plainMatch) return null;
  const plain = parseFloat(plainMatch[0].replace(/,/g, ""));
  return Number.isFinite(plain) ? Math.round(plain) : null;
}
