// src/lib/mime.js
import { extname } from "node:path";
import { fileTypeFromBuffer } from "file-type";

// Conservative allowlist; expand if your study truly needs more types.
export const ALLOWED_MIME = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/zip"
]);

export const ALLOWED_EXT = new Set([
  ".txt", ".csv", ".json", ".pdf", ".png", ".jpg", ".jpeg", ".zip"
]);

export function isAllowedExtension(name) {
  const ext = (extname(name || "") || "").toLowerCase();
  return ALLOWED_EXT.has(ext);
}

/**
 * Safety check:
 * - Prefer magic bytes detection; fall back to reported mime for types with no signature (txt/csv).
 * - Require BOTH an allowed extension and an allowed mime.
 */
export async function checkFileSafety({ buffer, originalName, fallbackMime }) {
  let detectedMime = null;

  try {
    const ft = await fileTypeFromBuffer(buffer);
    if (ft?.mime) detectedMime = ft.mime;
  } catch {
    // ignore detection errors; we'll rely on fallback
  }

  const usedMime = detectedMime || fallbackMime || "";
  const okMime =
    (detectedMime && ALLOWED_MIME.has(detectedMime)) ||
    (!detectedMime && ALLOWED_MIME.has(fallbackMime || ""));

  const okExt = isAllowedExtension(originalName);

  return { ok: okMime && okExt, detectedMime: detectedMime || null, usedMime, extOk: okExt };
}
