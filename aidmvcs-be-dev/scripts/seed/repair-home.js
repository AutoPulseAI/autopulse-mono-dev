/**
 * Re-imports all Vvveb HTML templates from public/vvvebjs/demo/landing/ into MongoDB.
 * Same as: npm run seed:cms:vvveb
 *
 * Run after editing index.html, pricing.html, etc. so the live site picks up changes.
 */
import { connectDb, disconnectDb, mongoose } from "./connect.js";
import { seedVvvebPages } from "./vvveb-pages.js";

async function main() {
  await connectDb();
  await seedVvvebPages();

  const PageSchema = new mongoose.Schema({ slug: String, editor: String, html: String, status: String });
  const Page = mongoose.models.Page || mongoose.model("Page", PageSchema);
  const home = await Page.findOne({ slug: "home" }).lean();
  console.log("Home page after seed:", {
    slug: home?.slug,
    editor: home?.editor,
    status: home?.status,
    htmlLength: home?.html?.length || 0,
  });

  await disconnectDb();
  console.log("Vvveb pages re-import complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
