/**
 * Imports VvvebJS HTML templates into the Page collection (editor: "vvveb").
 */
import path from "path";
import { fileURLToPath } from "url";
import { connectDb, disconnectDb, mongoose } from "./connect.js";
import {
  extractBodyHtml,
  extractSeoMeta,
  sanitizePageHtml,
  readLandingHtml,
} from "./vvveb-utils.js";
import { CMS_VVVEB_PAGES } from "../../app/lib/cmsPageRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = path.resolve(__dirname, "../../public/vvvebjs/demo/landing");

const PageSchema = new mongoose.Schema(
  {
    title: String,
    slug: { type: String, unique: true },
    status: String,
    showInNav: Boolean,
    navOrder: Number,
    navLabel: String,
    meta: Object,
    content: Object,
    html: String,
    editor: String,
    pageType: String,
    publishedAt: Date,
  },
  { timestamps: true }
);
const Page = mongoose.models.Page || mongoose.model("Page", PageSchema);

export const VVVEB_PAGES = CMS_VVVEB_PAGES;

export async function seedVvvebPages() {
  for (const def of VVVEB_PAGES) {
    const rawHtml = readLandingHtml(LANDING_DIR, def.file);
    if (!rawHtml) {
      console.warn(`Skipping ${def.slug}: ${def.file} not found`);
      continue;
    }

    const bodyHtml = sanitizePageHtml(extractBodyHtml(rawHtml));

    let page = await Page.findOne({ slug: def.slug });
    if (!page) {
      page = new Page({
        title: def.title,
        slug: def.slug,
        pageType: def.pageType || "marketing",
      });
    }

    page.title = def.title;
    page.html = bodyHtml;
    page.editor = "vvveb";
    page.status = "published";
    page.publishedAt = new Date();
    if (def.showInNav) {
      page.showInNav = true;
      page.navOrder = def.navOrder ?? 0;
      page.navLabel = def.navLabel || def.title;
    }

    const seo = extractSeoMeta(rawHtml);
    page.meta = page.meta || {};
    if (seo.title) page.meta.title = seo.title;
    if (seo.description) page.meta.description = seo.description;
    page.markModified("meta");

    await page.save();
    console.log(`Published /${def.slug === "home" ? "" : def.slug} from ${def.file} (${bodyHtml.length} chars)`);
  }
}

async function main() {
  await connectDb();
  await seedVvvebPages();
  await disconnectDb();
  console.log("Vvveb pages seed complete");
}

if (process.argv[1]?.endsWith("vvveb-pages.js")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
