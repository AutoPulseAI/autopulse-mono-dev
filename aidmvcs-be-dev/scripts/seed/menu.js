/**
 * Seeds default navigation menu items (header, footer, footer2, legal).
 * Header/footer/legal links are derived from app/lib/cmsPageRegistry.js.
 * Skips locations that already have items unless --force is passed.
 */
import { connectDb, disconnectDb, mongoose } from "./connect.js";
import { cmsNavPages, cmsLegalPages } from "../../app/lib/cmsPageRegistry.js";

const MenuItemSchema = new mongoose.Schema(
  {
    label: String,
    url: String,
    order: Number,
    visible: Boolean,
    target: String,
    location: String,
  },
  { timestamps: true }
);
const MenuItem = mongoose.models.MenuItem || mongoose.model("MenuItem", MenuItemSchema);

export const DEFAULT_MENU = {
  header: cmsNavPages(),
  footer: cmsNavPages(),
  footer2: [
    { label: "Dealer", url: "/dealer", order: 0 },
    { label: "Agency", url: "/agency", order: 1 },
  ],
  legal: cmsLegalPages(),
};

export async function seedMenu({ force = false } = {}) {
  const migrated = await MenuItem.updateMany(
    { location: { $exists: false } },
    { $set: { location: "header" } }
  );
  if (migrated.modifiedCount) {
    console.log(`Migrated ${migrated.modifiedCount} existing items to location "header"`);
  }

  for (const [location, items] of Object.entries(DEFAULT_MENU)) {
    const count = await MenuItem.countDocuments({ location });
    if (count > 0 && !force) {
      console.log(`"${location}" already has ${count} items, skipping (use --force to replace)`);
      continue;
    }

    if (force && count > 0) {
      await MenuItem.deleteMany({ location });
      console.log(`Cleared ${count} existing items in "${location}"`);
    }

    await MenuItem.insertMany(
      items.map((item) => ({ ...item, visible: true, target: "_self", location }))
    );
    console.log(`Seeded ${items.length} items for "${location}"`);
  }
}

async function main() {
  const force = process.argv.includes("--force");
  await connectDb();
  await seedMenu({ force });
  await disconnectDb();
  console.log("Menu seed complete");
}

if (process.argv[1]?.endsWith("menu.js")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
