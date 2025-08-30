import crypto from "node:crypto";

// 8-char uppercase base32-ish (no confusing chars)
export function genJoinCode() {
  const buf = crypto.randomBytes(5).toString("base64").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return buf.slice(0, 8);
}
