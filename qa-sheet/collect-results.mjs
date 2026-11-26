// Publishes the latest automated results on the feature & test sheet (qa-sheet/automated.json).
//   node qa-sheet/ui-check.mjs --json /tmp/qa-ui.json
//   node qa-sheet/collect-results.mjs --ui /tmp/qa-ui.json
// A suite left out keeps its previous published result.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "automated.json");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { suites: {} };
const suites = { ...prev.suites };
for (const key of ["ui"]) {
  const file = arg(`--${key}`);
  if (!file) continue;
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  suites[key] = { runAt: r.runAt, base: r.base, tests: r.tests };
}
fs.writeFileSync(OUT, JSON.stringify({ collectedAt: new Date().toISOString(), suites }, null, 1));
for (const [k, s] of Object.entries(suites)) console.log(`${k}: ${s.tests.filter((t) => t.ok).length}/${s.tests.length} pass (${s.runAt})`);
