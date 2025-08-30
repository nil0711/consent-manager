import cron from "node-cron";
import path from "node:path";
import fsp from "node:fs/promises";
import { prisma } from "../lib/prisma.js";

/**
 * Compute effective retention days for an upload (category override, else study default).
 * Returns an integer number of days or null if none configured.
 */
function effectiveRetentionDays(upload, category, study) {
  if (category?.retentionDays != null) return category.retentionDays;
  if (study?.retentionDefaultDays != null) return study.retentionDefaultDays;
  return null;
}

/**
 * Run a single sweep:
 * - find uploads not deleted
 * - join category + study for retention params
 * - if createdAt + retentionDays < now -> delete file & mark deletedAt
 * - audit RETENTION_PURGE
 */
export async function runRetentionSweep(now = new Date()) {
  // Pull candidates in batches to avoid loading everything
  const batchSize = 500;
  let lastId = null;
  let totalPurged = 0;

  for (;;) {
    const uploads = await prisma.upload.findMany({
      where: { deletedAt: null, ...(lastId ? { id: { gt: lastId } } : {}) },
      orderBy: { id: "asc" },
      take: batchSize,
      include: {
        category: true,
        study: true
      }
    });
    if (uploads.length === 0) break;
    lastId = uploads[uploads.length - 1].id;

    for (const u of uploads) {
      const days = effectiveRetentionDays(u, u.category, u.study);
      if (days == null) continue;

      const expiresAt = new Date(u.createdAt.getTime() + days * 24 * 60 * 60 * 1000);
      if (expiresAt > now) continue;

      // Delete file from disk if present
      const abs = path.join(process.cwd(), "uploads", u.filename);
      await fsp.unlink(abs).catch(() => { /* file may already be gone */ });

      // Mark deleted and write audit
      await prisma.$transaction([
        prisma.upload.update({ where: { id: u.id }, data: { deletedAt: now } }),
        prisma.auditLog.create({
          data: {
            studyId: u.studyId,
            actorRole: "system",
            actorId: null,
            action: "RETENTION_PURGE",
            details: {
              uploadId: u.id,
              category: u.category?.name || u.categoryId,
              createdAt: u.createdAt,
              retentionDays: days
            },
            prevHash: null,
            entryHash: "" // will be filled by app-level audit elsewhere; system events may omit chain
          }
        })
      ]);

      totalPurged++;
    }
  }

  return totalPurged;
}

let started = false;
export function startRetentionJob() {
  if (started) return;
  started = true;

  const cronExpr = process.env.RETENTION_CRON || "0 3 * * *"; // every day at 03:00
  cron.schedule(cronExpr, async () => {
    try {
      const n = await runRetentionSweep();
      if (n > 0) console.log(`[retention] purged ${n} expired uploads`);
    } catch (e) {
      console.error("[retention] sweep failed", e);
    }
  });

  // Optional: kick a lightweight sweep at boot (non-blocking)
  (async () => {
    try {
      const n = await runRetentionSweep();
      if (n > 0) console.log(`[retention] boot sweep purged ${n} uploads`);
    } catch (e) {
      console.error("[retention] boot sweep failed", e);
    }
  })();
}
