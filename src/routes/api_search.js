import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { performance } from "node:perf_hooks";

const DEBUG = process.env.DEBUG_SEARCH === "1";
const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/studies/search?q=...&per=20[&debug=1]
 */
router.get("/search", async (req, res) => {
  const t0 = performance.now();
  const raw = (req.query.q || "").toString();
  const q = raw.trim().slice(0, 128);
  const per = Math.min(Math.max(parseInt(req.query.per, 10) || 20, 1), 50);
  const wantDebug = DEBUG || req.query.debug === "1";

  if (wantDebug) {
    console.log(
      `[SEARCH.in] q="${q}" per=${per} ip=${req.ip} ua="${(req.headers["user-agent"] || "").slice(0, 80)}"`
    );
  }

  const where = q
    ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] }
    : {};

  try {
    const rows = await prisma.study.findMany({
      where,
      take: per,
      select: { slug: true, title: true, summary: true }
    });

    const items = rows.map((s) => ({
      slug: s.slug,
      title: s.title || s.slug,
      summary: s.summary || "",
      status: "public"
    }));

    const dur = (performance.now() - t0).toFixed(1);
    if (wantDebug) {
      console.log(`[SEARCH.out] count=${items.length} dur=${dur}ms q="${q}"`);
      res.set("X-Debug-Search-Query", q);
      res.set("X-Debug-Search-Count", String(items.length));
      res.set("X-Debug-Search-Duration", `${dur}ms`);
    }
    if (wantDebug) return res.json({ items, debug: { q, per, count: items.length, durationMs: Number(dur) } });
    return res.json({ items });
  } catch (err) {
    const dur = (performance.now() - t0).toFixed(1);
    console.error("[/api/studies/search] ERROR", { q, per, durMs: dur, err: String(err && err.message) });
    if (wantDebug) {
      res.set("X-Debug-Search-Error", (err && err.message) || "unknown");
      res.set("X-Debug-Search-Duration", `${dur}ms`);
    }
    return res.status(500).json({ error: "search_failed" });
  }
});

/**
 * GET /api/studies/trending
 * Returns up to 8 popular studies (uses metrics if present; falls back to consent counts).
 */
router.get("/trending", async (_req, res) => {
  try {
    // Prefer metrics if available
    let rows = [];
    try {
      rows = await prisma.$queryRaw`
        SELECT m.study_id AS id
        FROM study_metrics m
        ORDER BY m.score DESC, m.participants_count DESC, m.updated_at DESC
        LIMIT 8
      `;
    } catch (_) {
      // ignore — table may not exist yet
    }

    let ids = rows.map(r => r.id);

    // Fallback: compute by consents
    if (!ids.length) {
      const top = await prisma.consent.groupBy({
        by: ["studyId"],
        _count: { _all: true },
        orderBy: { _count: { _all: "desc" } },
        take: 8
      });
      ids = top.map(t => t.studyId);
    }

    const studies = ids.length
      ? await prisma.study.findMany({
          where: { id: { in: ids } },
          select: { id: true, slug: true, title: true, summary: true }
        })
      : [];

    const map = new Map(studies.map(s => [s.id, s]));
    const items = ids
      .map(id => map.get(id))
      .filter(Boolean)
      .map(s => ({
        slug: s.slug,
        title: s.title || s.slug,
        summary: s.summary || "",
        status: "public"
      }));

    return res.json({ items });
  } catch (e) {
    console.error("[/api/studies/trending]", e);
    return res.json({ items: [] });
  }
});

export default router;