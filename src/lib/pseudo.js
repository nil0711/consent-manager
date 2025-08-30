import crypto from "node:crypto";

/**
 * Stable per-study pseudonym for a participant.
 * No email; derived from studyId + participantId.
 * Format: ps_<10-hex>
 */
export function pseudonym(studyId, participantId) {
  const h = crypto.createHash("sha256").update(`${studyId}:${participantId}`).digest("hex");
  return `ps_${h.slice(0, 10)}`;
}
