import { NextResponse } from "next/server";
import sanitizeHtml from "sanitize-html";
import dbConnect from "@lib/mongodb";
import Page from "@models/Page";
import { verifyToken } from "@lib/auth";
import { normalizeSlug } from "@lib/pages";

// VvvebJS page name -> site slug
const NAME_TO_SLUG = { index: "home" };

const SLUG_TITLES = {
  home: "Home",
  about: "About Us",
  contact: "Contact",
  pricing: "Pricing",
  "book-a-demo": "Book A Demo",
  "terms-of-services": "Terms of Service",
  "privacy-policy": "Privacy Policy",
};

function getAdminFromRequest(request) {
  const authHeader = request.headers.get("authorization");
  let token = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
  if (!token) {
    token = request.cookies.get("admintoken")?.value || null;
  }
  if (!token) return null;
  const decoded = verifyToken(token);
  return decoded?.type === "admin" ? decoded : null;
}

function extractBodyHtml(fullHtml) {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(fullHtml);
  return (match ? match[1] : fullHtml).trim();
}

function extractSeoMeta(fullHtml) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(fullHtml);
  const descMatch =
    /<meta\s+name=["']description["']\s+content=(?:"([^"]*)"|'([^']*)')/i.exec(fullHtml) ||
    /<meta\s+content=(?:"([^"]*)"|'([^']*)')\s+name=["']description["']/i.exec(fullHtml);
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    description: descMatch ? (descMatch[1] ?? descMatch[2] ?? "").trim() : null,
  };
}

function sanitizePageHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img", "section", "article", "header", "footer", "aside", "nav",
      "form", "input", "textarea", "button", "select", "option", "label",
      "i", "svg", "path", "video", "source", "iframe", "figure", "figcaption",
    ]),
    allowedAttributes: {
      "*": ["class", "id", "style", "data-*", "aria-*", "role", "title"],
      a: ["href", "target", "rel", "name"],
      img: ["src", "srcset", "alt", "width", "height", "loading"],
      input: ["type", "name", "placeholder", "required", "value", "pattern", "minlength", "maxlength"],
      textarea: ["name", "placeholder", "required", "rows", "minlength", "maxlength"],
      button: ["type", "disabled"],
      form: ["action", "method", "data-autopulse-contact", "data-autopulse-demo"],
      select: ["name", "required"],
      option: ["value", "selected"],
      label: ["for"],
      iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen"],
      video: ["src", "controls", "autoplay", "muted", "loop", "poster", "width", "height"],
      source: ["src", "type"],
      svg: ["viewbox", "xmlns", "width", "height", "fill"],
      path: ["d", "fill", "stroke"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedIframeHostnames: ["www.youtube.com", "player.vimeo.com", "www.google.com"],
  });
}

export async function POST(request) {
  const admin = getAdminFromRequest(request);
  if (!admin) {
    return new NextResponse("Unauthorized: log in to the admin panel first", { status: 401 });
  }

  try {
    const formData = await request.formData();
    const name = formData.get("name") || formData.get("file") || "";
    const html = formData.get("html");
    const title = formData.get("title");

    if (!name || !html) {
      return new NextResponse("Missing page name or html", { status: 400 });
    }

    // "demo/landing/contact.html" or "contact" -> "contact"
    const baseName = String(name).split("/").pop().replace(/\.html$/i, "");
    const slug = normalizeSlug(NAME_TO_SLUG[baseName] || baseName);
    if (!slug || slug === "blank") {
      return new NextResponse(`Page "${baseName}" is a template and cannot be published`, { status: 400 });
    }

    const bodyHtml = sanitizePageHtml(extractBodyHtml(String(html)));

    await dbConnect();
    let page = await Page.findOne({ slug });
    if (!page) {
      page = new Page({
        title: SLUG_TITLES[slug] || title || baseName,
        slug,
        status: "published",
        pageType: "marketing",
        createdBy: admin.userId,
      });
    }

    page.html = bodyHtml;
    page.editor = "vvveb";

    // Sync SEO meta from the page <head> (editable via Vvveb's code editor)
    const seo = extractSeoMeta(String(html));
    page.meta = page.meta || {};
    if (seo.title) page.meta.title = seo.title;
    if (seo.description) page.meta.description = seo.description;
    page.markModified("meta");

    if (page.status !== "published") {
      page.status = "published";
    }
    page.publishedAt = new Date();
    await page.save();

    return new NextResponse(`Saved and published to /${slug === "home" ? "" : slug}`, { status: 200 });
  } catch (error) {
    console.error("Error saving vvveb page:", error);
    return new NextResponse(error.message || "Server error", { status: 500 });
  }
}
