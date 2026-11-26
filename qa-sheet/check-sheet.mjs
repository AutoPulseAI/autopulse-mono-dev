// Is the feature & test sheet still in step with the code? Fast, no server, no browser:
//   node qa-sheet/check-sheet.mjs            (exit 1 when something is out of date)
// 1. Every page (app/**/page.js) has a section in catalog.mjs, and every section is still a page.
// 2. The inventory (what the UI check found) is newer than the last change to any page or component.
// 3. features.json was built after the last change to catalog.mjs, inventory.json and tracker.json.
// Rule (the user, 27 Nov 2026): a feature added, changed or removed updates this sheet in the same change.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SECTIONS } from "./catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const root = path.join(repo, "aidmvcs-be-dev");
const problems = [];

// 1. Pages and sections
const routes = [];
const walk = (dir, parts) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!["api", "node_modules"].includes(e.name)) walk(path.join(dir, e.name), [...parts, e.name]); }
    else if (/^page\.(js|jsx|tsx)$/.test(e.name)) routes.push(parts.filter((p) => !/^\(.*\)$/.test(p)).join("/") || "home");
  }
};
walk(path.join(root, "app"), []);
const pages = new Set(routes.filter((r) => !/^agency(\/|$)/.test(r)));
const sections = new Set(SECTIONS.map((s) => s.id).filter((id) => !id.endsWith("/_menu")));
for (const p of pages) if (!sections.has(p)) problems.push(`Page /${p} has no section in qa-sheet/catalog.mjs`);
for (const s of sections) if (!pages.has(s)) problems.push(`Section '${s}' in qa-sheet/catalog.mjs is not a page any more (remove or rename it)`);

// 2 and 3. Dates: the last commit (or the file's own time when it has uncommitted changes) of each side.
const changedAt = (paths) => {
  let t = 0;
  for (const p of paths) {
    try {
      const dirty = execFileSync("git", ["status", "--porcelain", "--", p], { cwd: root, encoding: "utf8" }).trim();
      if (dirty) {
        const files = execFileSync("git", ["ls-files", "-m", "-o", "--exclude-standard", "--", p], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
        for (const f of files) t = Math.max(t, fs.statSync(path.join(root, f)).mtimeMs);
      }
      const c = execFileSync("git", ["log", "-1", "--format=%ct", "--", p], { cwd: root, encoding: "utf8" }).trim();
      if (c) t = Math.max(t, Number(c) * 1000);
    } catch { /* not a git checkout: dates are skipped */ }
  }
  return t;
};
const read = (f) => (fs.existsSync(path.join(here, f)) ? JSON.parse(fs.readFileSync(path.join(here, f), "utf8")) : null);
const inventory = read("inventory.json");
const features = read("features.json");
const ui = changedAt(["app/dealer", "app/admin", "app/(auth)", "app/(frontpages)", "app/components"]);
if (!inventory) problems.push("qa-sheet/inventory.json is missing: run node qa-sheet/ui-check.mjs --write-inventory");
else if (ui > Date.parse(inventory.crawledAt) + 60_000) problems.push(`Pages changed (${new Date(ui).toISOString()}) after the last UI check (${inventory.crawledAt}): run node qa-sheet/ui-check.mjs --write-inventory on the local copy`);
const sources = changedAt(["../qa-sheet/catalog.mjs", "../qa-sheet/inventory.json", "../qa-sheet/tracker.json"]);
if (!features) problems.push("qa-sheet/features.json is missing: run node qa-sheet/build-sheet.mjs");
else if (sources > Date.parse(features.generatedAt) + 60_000) problems.push("catalog / inventory / tracker changed after features.json was built: run node qa-sheet/build-sheet.mjs");

if (problems.length) {
  console.log(`The feature & test sheet is out of date (${problems.length}):\n  - ${problems.join("\n  - ")}`);
  process.exitCode = 1;
} else console.log(`Feature & test sheet is current: ${pages.size} pages, all in the catalog; inventory ${inventory.crawledAt}; built ${features.generatedAt}.`);
