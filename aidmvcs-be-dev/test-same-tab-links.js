// Same-tab links (client, 11 Nov 2026): a Dashboard number, chart, reply-by-age link or report number opens the Leads
// list in the same tab, remembering the way back; the Leads page shows "Back to Dashboard" only for that list.
// Reads the sources (they are JSX, which plain node can't import).
//   Run: node --test test-same-tab-links.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
async function files(dir) {
  const out = [];
  for (const e of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await files(`${dir}${e.name}/`));
    else if (e.name.endsWith('.js')) out.push(`${dir}${e.name}`);
  }
  return out;
}

test('no Dashboard or report link opens a new tab', async () => {
  for (const f of [...await files('./app/dealer/dashboard/'), ...await files('./app/dealer/reports/')]) {
    const src = await read(f);
    assert.ok(!/target=["{]_blank|window\.open\(/.test(src), `${f} opens a new tab`);
  }
});

test('every way out of the Dashboard remembers the way back', async () => {
  assert.match(await read('./app/dealer/dashboard/components/CountCard.js'), /onClick=\{\(\) => rememberBack\(link\)\}/);
  const page = await read('./app/dealer/dashboard/page.js');
  assert.equal((page.match(/openFromDashboard\(url, router\)/g) || []).length, 5);
  assert.match(page, /const kept = takeBackRange\(\);/);
  assert.match(await read('./app/dealer/dashboard/components/ReplyCohortsSection.js'), /openFromDashboard\(leadsLink/);
  assert.match(await read('./app/dealer/reports/components/Charts.js'), /const go = \(row\) => openFromDashboard\(/);
  assert.match(await read('./app/dealer/reports/components/KpiCards.js'), /onClick: \(\) => rememberBack\(link\)/);
});

test('the Leads page shows the back button only for the list it was opened for', async () => {
  assert.match(await read('./app/dealer/leads/page.js'), /\{!selectedLead && <BackButton \/>\}/);
  const src = await read('./app/dealer/components/backLink.js');
  assert.match(src, /if \(want\.pathname !== location\.pathname\) return null;/);
  assert.match(src, /for \(const \[k, v\] of want\.searchParams\) if \(now\.get\(k\) !== v\) return null;/);
});
