import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/mw.js";

const router = Router();

// Participant home: enrolled studies + public catalog
router.get("/participant", requireAuth("participant"), async (req, res) => {
  const userId = req.session.user.id;

  // Grab any flash-y messages carried via querystring
  const notice = req.query.msg || null;
  const error  = req.query.err || null;

  const enrolled = await prisma.enrollment.findMany({
    where: { participantId: userId },
    include: { study: { include: { categories: true } } },
    orderBy: { createdAt: "desc" }
  });

  const publicStudies = await prisma.study.findMany({
    where: { status: "public" },
    orderBy: { createdAt: "desc" },
    include: { categories: true }
  });

  res.render("participant", {
    title: "Participant",
    user: req.session.user,
    enrolledStudies: enrolled.map(e => e.study),
    publicStudies,
    notice,
    error
  });
});

// Join via invite code (robust w/ graceful errors)
router.post("/join", requireAuth("participant"), async (req, res) => {
  try {
    const raw = (req.body && req.body.code) ? String(req.body.code) : "";
    const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (!code) {
      return res.redirect("/participant?err=" + encodeURIComponent("Join code is required."));
    }
    // Optional: basic format check to prevent accidental spaces etc.
    if (code.length < 6 || code.length > 12) {
      return res.redirect("/participant?err=" + encodeURIComponent("That code doesn’t look right."));
    }

    const study = await prisma.study.findFirst({
      where: { status: "invite", joinCode: code }
    });

    if (!study) {
      return res.redirect("/participant?err=" + encodeURIComponent("No invite-only study matches that code."));
    }

    await prisma.enrollment.upsert({
      where: { studyId_participantId: { studyId: study.id, participantId: req.session.user.id } },
      create: { studyId: study.id, participantId: req.session.user.id },
      update: {}
    });

    await prisma.auditLog.create({
      data: {
        studyId: study.id,
        actorRole: "participant",
        actorId: req.session.user.id,
        action: "ENROLLED",
        details: { via: "code" }
      }
    });

    // success: go straight to the study
    return res.redirect(`/s/${study.slug}`);
  } catch (e) {
    console.error("[/join] failed", e);
    // fall back to a friendly error on the dashboard
    return res.redirect("/participant?err=" + encodeURIComponent("Join failed. Please try again."));
  }
});

export default router;
