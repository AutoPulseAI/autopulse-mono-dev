import path from "path";
import { getPublicUrl } from "./aws-s3.js";
import { verifyToken } from "./auth.js";

/** S3 prefix for CMS / Vvveb editor uploads */
export const CMS_MEDIA_PREFIX = "cms-media";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function getCmsMediaBaseUrl() {
  return getPublicUrl(CMS_MEDIA_PREFIX);
}

export function getAdminFromRequest(request) {
  const authHeader = request.headers.get("authorization");
  let token = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
  if (!token) {
    token = request.cookies.get("admintoken")?.value || null;
  }
  if (!token) return null;
  const decoded = verifyToken(token);
  return decoded?.type === "admin" ? decoded : null;
}

export function sanitizeUploadFilename(originalName) {
  const base = path.basename(originalName || "upload.bin");
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const ext = path.extname(safe).toLowerCase().slice(0, 10);
  const stem = path.basename(safe, ext).slice(0, 80) || "file";
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${stem}_${unique}${ext || ".bin"}`;
}

export function validateMediaFile(file) {
  if (!file || typeof file === "string") {
    return "No file provided";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "File size exceeds 10MB limit";
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return `File type not allowed: ${file.type}`;
  }
  return null;
}

/** Vvveb scan.php-compatible path: /filename.jpg */
export function toVvvebMediaPath(s3Key) {
  const prefix = `${CMS_MEDIA_PREFIX}/`;
  const name = s3Key.startsWith(prefix) ? s3Key.slice(prefix.length) : path.basename(s3Key);
  return `/${name}`;
}
