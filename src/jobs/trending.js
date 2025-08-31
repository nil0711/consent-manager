// src/jobs/trending.js
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const ONE_HOUR_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 7;

// Introspect schema for flexible field names
const DMMF = Prisma.dmmf;
const models = Object.fromEntries(DMMF.datamodel.models.map(m => [m.name, m]));
const hasModel = (n) => !!models[n];
const hasField = (m, f) => !!models[m]?.fields?.some(x => x.name === f);

// Create cache table if missing (raw SQL so we don't touch schema.prisma)
async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS study_trending (
      study_id TEXT PRIMARY KEY,
      enrollments_7d INTEGER NOT NULL DEFAULT 0,
      withdrawals_7d INTEGER NOT NULL DEFAULT 0,
      uploads_7d INTEGER NOT NULL DEFAULT 0,
      score DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function scoreOf({ enrollments, uploads, withdrawals }) {
  // Simple, explainable scoring
  // tweak anytime: enrollments weigh more, withdrawals penalize
  return enrollments * 3 + uploads * 1 - withdrawals * 2;
}

// Build where clauses defensively to survive schema drift
function sinceClause(model, dateField, since) {
  if (!hasField(model, dateField)) return undefined;
  return { [dateField]: { gte: since } };
}

async function recomputeOnce() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const studies = await prisma.study.findMany({ select: { id: true } });

  const consentHasCreatedAt  = hasField("Consent", "createdAt");
  const consentHasWithdrawn  = hasField("Consent", "withdrawn");
  const consentHasWithdrawnAt= hasField("Consent", "withdrawnAt");

  const uploadAvailable      = hasModel("Upload");
  const uploadHasCreatedAt   = hasField("Upload", "createdAt");
  const uploadHasStudyId     = hasField("Upload", "studyId");

  // Per-study (bounded) — OK for hourly job and dev volumes
  for (const s of studies) {
    let enrollments = 0;
    let withdrawals = 0;
    let uploads     = 0;

    try {
      // Enrollments = Consent rows created in window (best effort)
      if (consentHasCreatedAt) {
        enrollments = await prisma.consent.count({
          where: {
            studyId: s.id,
            ...(consentHasCreatedAt ? sinceClause("Consent", "createdAt", since) : {}),
            ...(consentHasWithdrawn ? { OR: [{ withdrawn: false }, { withdrawn: null }] } : {}),
          },
        });
      }

      // Withdrawals in the window (if fields exist)
      if (consentHasWithdrawn && consentHasWithdrawnAt) {
        withdrawals = await prisma.consent.count({
          where: {
            studyId: s.id,
            withdrawn: true,
            ...sinceClause("Consent", "withdrawnAt", since),
          },
        });
      }

      // Uploads in the window (if model/fields exist)
      if (uploadAvailable && uploadHasStudyId && uploadHasCreatedAt) {
        uploads = await prisma.upload.count({
          where: {
            studyId: s.id,
            ...sinceClause("Upload", "createdAt", since),
          },
        });
      }

      const score = scoreOf({ enrollments, withdrawals, uploads });

      await prisma.$executeRawUnsafe(
        `
        INSERT INTO study_trending (study_id, enrollments_7d, withdrawals_7d, uploads_7d, score, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (study_id)
        DO UPDATE SET
          enrollments_7d = EXCLUDED.enrollments_7d,
          withdrawals_7d = EXCLUDED.withdrawals_7d,
          uploads_7d     = EXCLUDED.uploads_7d,
          score          = EXCLUDED.score,
          updated_at     = NOW();
        `,
        s.id, enrollments, withdrawals, uploads, score
      );
    } catch (e) {
      console.error("[trending] compute error for study", s.id, e.message || e);
    }
  }

  console.log(`[trending] recomputed for ${studies.length} studies (window ${WINDOW_DAYS}d)`);
}

let _timer = null;
export async function startTrendingJob() {
  try {
    await ensureTable();
    await recomputeOnce();          // run immediately on boot
  } catch (e) {
    console.error("[trending] boot error:", e.message || e);
  }
  _timer = setInterval(() => {
    recomputeOnce().catch(e => console.error("[trending] interval error:", e.message || e));
  }, ONE_HOUR_MS);                  // hourly
}
export function stopTrendingJob() {
  if (_timer) clearInterval(_timer);
}
