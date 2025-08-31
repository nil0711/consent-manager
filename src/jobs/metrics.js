// src/jobs/metrics.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Create or evolve the metrics table safely.
// (Older tables may exist without the new columns.)
async function ensureTable() {
  // Create if missing (full definition)
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS study_metrics (
      study_id TEXT PRIMARY KEY,
      participants_count INTEGER NOT NULL DEFAULT 0,
      score DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Add missing columns if the table was created previously
  await prisma.$executeRaw`ALTER TABLE study_metrics ADD COLUMN IF NOT EXISTS participants_count INTEGER NOT NULL DEFAULT 0`;
  await prisma.$executeRaw`ALTER TABLE study_metrics ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION NOT NULL DEFAULT 0`;
  await prisma.$executeRaw`ALTER TABLE study_metrics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
}

/**
 * Recompute metrics:
 *  - participants_count: total Consent rows per study
 *  - score: same value for now (extendable later)
 */
export async function recomputeStudyMetrics() {
  try {
    await ensureTable();

    // Studies list
    const studies = await prisma.study.findMany({ select: { id: true } });

    // Count enrollments (consents) per study
    const grouped = await prisma.consent.groupBy({
      by: ["studyId"],
      _count: { _all: true },
    });
    const countMap = new Map(grouped.map(g => [g.studyId, Number(g._count._all) || 0]));

    // Upsert one row per study
    for (const s of studies) {
      const c = countMap.get(s.id) ?? 0;
      const score = c;

      await prisma.$executeRaw`
        INSERT INTO study_metrics (study_id, participants_count, score, updated_at)
        VALUES (${s.id}, ${c}, ${score}, NOW())
        ON CONFLICT (study_id) DO UPDATE
        SET participants_count = EXCLUDED.participants_count,
            score = EXCLUDED.score,
            updated_at = EXCLUDED.updated_at
      `;
    }
  } catch (err) {
    console.error("[metrics] recompute failed", err);
    // Do not crash the app if metrics cannot run
  }
}

// Boot + hourly
export function startMetricsJob() {
  setTimeout(() => { recomputeStudyMetrics().catch(() => {}); }, 2500);
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => { recomputeStudyMetrics().catch(() => {}); }, ONE_HOUR);
}
