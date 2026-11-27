// A colour per person for the round avatars (the Leads inbox, 27 Nov 2026): the same name always gets the same
// gradient. No framework imports.
const GRADIENTS = [
  ["#6366f1", "#8b5cf6"], ["#0ea5e9", "#2563eb"], ["#10b981", "#059669"], ["#f59e0b", "#ea580c"],
  ["#ec4899", "#db2777"], ["#14b8a6", "#0d9488"], ["#f43f5e", "#e11d48"], ["#84cc16", "#16a34a"],
  ["#a855f7", "#7c3aed"], ["#06b6d4", "#0891b2"], ["#fb7185", "#f97316"], ["#64748b", "#334155"],
];

export function initialsOf(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export function avatarStyle(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const [a, b] = GRADIENTS[h % GRADIENTS.length];
  return { background: `linear-gradient(135deg, ${a}, ${b})`, color: "#fff" };
}
