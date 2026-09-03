import fs from "fs";
import path from "path";
import sanitizeHtml from "sanitize-html";

export function extractBodyHtml(fullHtml) {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(fullHtml);
  return (match ? match[1] : fullHtml).trim();
}

export function extractSeoMeta(fullHtml) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(fullHtml);
  const descMatch =
    /<meta\s+name=["']description["']\s+content=(?:"([^"]*)"|'([^']*)')/i.exec(fullHtml) ||
    /<meta\s+content=(?:"([^"]*)"|'([^']*)')\s+name=["']description["']/i.exec(fullHtml);
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    description: descMatch ? (descMatch[1] ?? descMatch[2] ?? "").trim() : null,
  };
}

/** Keep in sync with app/api/pages/vvveb-save/route.js */
export function sanitizePageHtml(html) {
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

export function readLandingHtml(landingDir, file) {
  const filePath = path.join(landingDir, file);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}
