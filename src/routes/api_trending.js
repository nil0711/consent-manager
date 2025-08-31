// src/routes/api_trending.js
import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/studies/trending?limit=6
 * Returns [{ slug, title, summary, status, score }]
 */
router.get("/trending", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 24);

  try {
    // status/visibility can vary; use COALESCE for portable filter
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        s.slug,
        s.title,
        COALESCE(s.summary, s.purpose, s.description, '') AS summary,
        COALESCE(s.status, s.visibility, 'public')        AS status,
        t.score
      FROM study_trending t
      JOIN "Study" s ON s.id = t.study_id
      WHERE COALESCE(s.status, s.visibility, 'public') = 'public'
      ORDER BY t.score DESC NULLS LAST
      LIMIT $1;
      `,
      limit
    );

    res.json({ items: rows || [] });
  } catch (e) {
    console.error("[/api/studies/trending] ERROR", e.message || e);
    res.status(500).json({ error: "trending_failed" });
  }
});

export default router;
