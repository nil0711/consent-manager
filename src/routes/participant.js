// src/routes/participant.js
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireLogin } from "../lib/mw.js";
import crypto from "node:crypto";

const router = Router();

/* ------------------------------- helpers -------------------------------- */

async function addAudit(studyId, actorRole, actorId, action, details = {}) {
  const prev = await prisma.auditLog.findFirst({
    where: { studyId },
    orderBy: { createdAt: "desc" },
    select: { entryHash: true }
  });
  const createdAt = new Date();
  const body =
    (prev?.entryHash || "") +
    action +
    JSON.stringify(details) +
    createdAt.toISOString();
  const entryHash = crypto.createHash("sha256").update(body).digest("hex");
  return prisma.auditLog.create({
    data: {
      studyId,
      actorRole,
      actorId,
      action,
      details,
      prevHash: prev?.entryHash || null,
      entryHash
    }
  });
}

function normCode(raw) {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ------------------------------- dashboard ------------------------------ */

router.get("/participant", requireAuth("participant"), async (req, res) => {
  // show enrolled studies; rest of the page (Trending/search) is hydrated by JS
  const enrolledStudies = await prisma.study.findMany({
    where: {
      status: { not: "draft" },
      enrollments: { some: { participantId: req.session.user.id } }
    },
    orderBy: { createdAt: "desc" },
    include: { categories: true }
  });

  res.render("participant", {
    title: "Studies",
    user: req.session.user,
    enrolledStudies,
    // allow page to optionally show a notice/error passed via query
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

/* ------------------------------ join by code ---------------------------- */

// GET guard so navigating to /participant/join never 404s
router.get("/participant/join", requireAuth("participant"), (req, res) => {
  return res.redirect("/participant");
});

// POST: join a study using a code (usually for invite studies)
router.post("/participant/join", requireAuth("participant"), async (req, res) => {
  try {
    const code = normCode(req.body?.code);
    if (code.length < 4 || code.length > 16) {
      // re-render participant with inline error
      const enrolledStudies = await prisma.study.findMany({
        where: {
          status: { not: "draft" },
          enrollments: { some: { participantId: req.session.user.id } }
        },
        orderBy: { createdAt: "desc" },
        include: { categories: true }
      });
      return res.status(400).render("participant", {
        title: "Studies",
        user: req.session.user,
        enrolledStudies,
        joinError: "Invalid join code format."
      });
    }

    // Find a non-draft study with this code.
    // We store joinCode uppercased when creating/editing; compare exact after normalization.
    const study = await prisma.study.findFirst({
      where: {
        joinCode: code,
        status: { in: ["invite", "public"] } // allow code on public if they use one
      },
      include: { categories: true }
    });

    if (!study) {
      const enrolledStudies = await prisma.study.findMany({
        where: {
          status: { not: "draft" },
          enrollments: { some: { participantId: req.session.user.id } }
        },
        orderBy: { createdAt: "desc" },
        include: { categories: true }
      });
      return res.status(404).render("participant", {
        title: "Studies",
        user: req.session.user,
        enrolledStudies,
        joinError: "No study found for that join code."
      });
    }

    // Enroll (idempotent)
    await prisma.enrollment.upsert({
      where: {
        studyId_participantId: {
          studyId: study.id,
          participantId: req.session.user.id
        }
      },
      create: { studyId: study.id, participantId: req.session.user.id },
      update: {}
    });

    await addAudit(
      study.id,
      "participant",
      req.session.user.id,
      "ENROLLED",
      { via: "join_code", code }
    );

    // Go straight to the study page
    return res.redirect(`/s/${study.slug}`);
  } catch (e) {
    console.error("[participant/join]", e);
    // Render a friendly error on the page
    const enrolledStudies = await prisma.study.findMany({
      where: {
        status: { not: "draft" },
        enrollments: { some: { participantId: req.session.user.id } }
      },
      orderBy: { createdAt: "desc" },
      include: { categories: true }
    });
    return res.status(500).render("participant", {
      title: "Studies",
      user: req.session.user,
      enrolledStudies,
      joinError: "Unexpected error joining study. Please try again."
    });
  }
});

export default router;
