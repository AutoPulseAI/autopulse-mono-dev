/**
 * Runs all CMS seeders in order:
 *   1. permissions   – admin "Manage Pages" permission
 *   2. vvveb         – HTML templates → MongoDB pages
 *   3. menu          – header/footer navigation
 *   4. site-settings – contact info + social links
 *
 * Prerequisites: MONGODB_URI in .env.local
 *
 * Usage:
 *   npm run seed:cms                          (full first-time setup)
 *   npm run seed:cms -- --force               (overwrite menu + site settings)
 *   npm run seed:cms -- --only=vvveb          (re-import HTML templates only)
 *   npm run seed:cms:vvveb                    (same as --only=vvveb)
 */
import { connectDb, disconnectDb } from "./connect.js";
import { seedPermissions } from "./permissions.js";
import { seedVvvebPages } from "./vvveb-pages.js";
import { seedMenu } from "./menu.js";
import { seedSiteSettings } from "./site-settings.js";

const STEPS = {
  permissions: { label: "Admin permissions", run: seedPermissions },
  vvveb: { label: "Vvveb pages", run: seedVvvebPages },
  menu: { label: "Navigation menu", run: (opts) => seedMenu(opts) },
  "site-settings": { label: "Site settings", run: (opts) => seedSiteSettings(opts) },
};

function parseArgs() {
  const force = process.argv.includes("--force");
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg
    ? onlyArg
        .replace("--only=", "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : Object.keys(STEPS);

  const unknown = only.filter((key) => !STEPS[key]);
  if (unknown.length) {
    throw new Error(`Unknown seeder(s): ${unknown.join(", ")}. Valid: ${Object.keys(STEPS).join(", ")}`);
  }

  return { force, only };
}

async function main() {
  const { force, only } = parseArgs();
  const opts = { force };

  console.log("=== CMS Seed ===");
  if (force) console.log("(force mode: menu and site-settings will overwrite existing data)\n");

  await connectDb();

  for (const key of only) {
    const step = STEPS[key];
    console.log(`\n--- ${step.label} ---`);
    await step.run(opts);
  }

  await disconnectDb();
  console.log("\n=== All done ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
