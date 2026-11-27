# Feature & test sheet

A private page for the testing team. It lists every page of the CRM. For each page it shows:

- what the page does, with steps to test it and the expected result;
- the SOW v6 items the page delivers;
- every button, link, tab and field on the page, including the ones inside its menus, pop-ups and show/hide parts.

Each tester marks each row **Pass**, **Fail** or **Blocked**. A row can also carry a note and screenshots. Screenshots can be pasted (Ctrl+V), dragged in or chosen from a file, in the screenshot box or straight into the note. **Cancel** takes a result back: nothing stays recorded for that row (no result, note, screenshots or issue). Once someone else has worked on the issue it opened, Cancel is refused and the tester re-tests instead.

A Fail opens an issue. The issue goes through these states:

1. **Open** when a tester marks the row Fail.
2. **Fixed** when the developer says what changed.
3. **Closed** when a lead tester verifies the fix.

A row that fails again after a fix reopens the issue. Every step is kept in the issue's history.

## Where it lives

The link is **https://www.autopulse.ai/test/testing-sheet/<key>/**. There is no password: anyone who has the link opens it, types their name at the top and starts testing. Agents use the same link. The key makes the address impossible to guess, and a wrong key gets a plain 404.

It is its own small server (`server.mjs`), separate from the CRM:

- **No CRM code and no CRM database.** It uses no packages. Results are kept in `/var/www/html/qa-sheet-data/results.json`, and screenshots in `shots/` next to that file.
- **How requests reach it:** nginx sends `/test/` to `127.0.0.1:3990`, where it runs as PM2 `qa-sheet`.
- **How it deploys:** merged to main, the auto-deploy's "Deploy qa-sheet" step copies this folder to `/var/www/html/qa-sheet` and starts or restarts PM2 `qa-sheet`. A change only in this folder does not redeploy the CRM or the AI.
- **Settings:** they are kept in `/var/www/html/qa-sheet-data/settings.env`:
  - `QA_SHEET_KEY` (the link's key, 16+ characters);
  - `QA_LEAD_TESTERS` (the only people who may close a bug);
  - optionally `QA_DEVELOPER`, `PORT` and `SHEET_BASE`.

## Files

| File | What it is |
|---|---|
| `catalog.mjs` | The hand-written part: one section per page, with its features, steps, expected results, SOW tracker rows and button notes. |
| `inventory.json` | Every page, tab, pop-up, button, link and field that `ui-check.mjs` found. |
| `tracker.json` | A copy of the SOW v6 gap tracker rows (`planning/P1-TRACKER.csv`). |
| `build-sheet.mjs` | Joins the three files above into `features.json`, the data the page shows. |
| `ui-check.mjs` | Opens every page in headless Chrome. It writes the inventory (`--write-inventory`), or checks the app against it (`--json`). |
| `collect-results.mjs` | Publishes the latest UI check result on the sheet (`automated.json`). |
| `sheet.html`, `sheet.css`, `sheet.js` | The page itself. |
| `server.mjs` | The sheet's own web server: the link key, the results file and the screenshots. |

## Updating it after a change to the CRM

Run these on a local copy (`local-test/start.sh`, port 3137). Never run them against live data.

```
node qa-sheet/ui-check.mjs --write-inventory     # list every page again
node qa-sheet/build-sheet.mjs                    # rebuild features.json; it prints dead links and pages it could not open
node qa-sheet/ui-check.mjs --json /tmp/qa-ui.json && node qa-sheet/collect-results.mjs --ui /tmp/qa-ui.json
```

`ui-check.mjs` settings:

- `APP_URL`: the copy to check. Default `http://127.0.0.1:3137`.
- `DEALER_TOKEN`, `ADMIN_TOKEN`: session tokens. They default to the tokens in `local-test/`.
- `ONLY=<regex of page addresses>`: check only some pages.
- `IGNORE_ERRORS=<regex>`: errors to leave out. Example: `/api/dealer-ai/` when the AI service is not running locally.

The UI check only presses buttons that open something: tabs, menus, pop-ups and show/hide parts. It never presses Delete, Send, Save, Submit, Sync, Approve, Export or similar buttons.

## Keeping it current (rule: every change updates the sheet)

When a change adds, changes or removes a feature, page, tab, button or field, update the sheet in the same change:

1. In `catalog.mjs`, update the page's section: its features, steps and expected results. Add a section for a new page, and remove the section of a page that no longer exists.
2. Run `node qa-sheet/ui-check.mjs --write-inventory` on the local copy.
3. Run `node qa-sheet/build-sheet.mjs`.
4. Run `node qa-sheet/check-sheet.mjs`. It must print "current".

`check-sheet.mjs` fails in any of these cases:

- a page has no section;
- a section's page no longer exists;
- pages or components changed after the last UI check;
- `features.json` is older than its sources.

Testers' results for removed rows stay in results.json, but the sheet no longer shows them.

