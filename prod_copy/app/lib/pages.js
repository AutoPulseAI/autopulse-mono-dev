import dbConnect from "@lib/mongodb";
import Page from "@models/Page";
import { getStaticVvvebPage } from "@lib/vvvebStatic";

export function normalizeSlug(slug) {
  return String(slug || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getEmptyPuckData() {
  return { content: [], root: { props: {} } };
}

/** True when a page document has content the frontend can render. */
export function isPageRenderable(page) {
  if (!page) return false;
  if (page.editor === "vvveb" && String(page.html || "").trim()) return true;
  if (Array.isArray(page.content?.content) && page.content.content.length > 0) return true;
  return false;
}

export async function getPageBySlug(slug, { includeDraft = false } = {}) {
  await dbConnect();
  const normalizedSlug = normalizeSlug(slug);
  const query = { slug: normalizedSlug };
  if (!includeDraft) {
    query.status = "published";
  }
  return Page.findOne(query).lean();
}

/**
 * Returns a published page. Prefers saved Vvveb HTML from MongoDB, then
 * bundled static templates, then Puck content. This ensures /home works
 * even when the DB still has an old empty Puck record.
 */
export async function getPublishedPage(slug) {
  const normalizedSlug = normalizeSlug(slug);
  const staticPage = getStaticVvvebPage(normalizedSlug);
  let page = null;

  try {
    page = await getPageBySlug(normalizedSlug);
  } catch (error) {
    console.error(`getPublishedPage: DB lookup failed for "${normalizedSlug}"`, error);
  }

  // Saved Vvveb HTML from admin/editor takes priority
  if (page?.editor === "vvveb" && String(page.html || "").trim()) {
    return page;
  }

  // Static Vvveb template (fixes home when DB has empty/old Puck data)
  if (staticPage) {
    if (page && page.editor !== "vvveb") {
      console.warn(
        `getPublishedPage: "${normalizedSlug}" using static Vvveb (DB has editor=${page.editor || "unknown"})`
      );
    }
    return staticPage;
  }

  if (isPageRenderable(page)) {
    return page;
  }

  return page;
}

export async function getPublishedNavPages() {
  await dbConnect();
  return Page.find({ status: "published", showInNav: true })
    .sort({ navOrder: 1, title: 1 })
    .select("title slug navLabel navOrder")
    .lean();
}
