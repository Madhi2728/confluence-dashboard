// Shared formatting helpers used by both ConfluenceDashboard and the extracted
// AskConfluence chat component.

export function formatRupees(n) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}
