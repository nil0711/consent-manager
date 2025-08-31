// src/routes/study.js
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireLogin } from "../lib/mw.js";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import multer from "multer";
import puppeteer from "puppeteer";
import { checkFileSafety } from "../lib/mime.js";

const router = Router();

/* --------------------------------- helpers -------------------------------- */

async function addAudit(studyId, actorRole, actorId, action, details = {}) {
  const prev = await prisma.auditLog.findFirst({
    where: { studyId },
    orderBy: { createdAt: "desc" },
    select: { entryHash: true }
  });
  const createdAt = new Date();
  const body = (prev?.entryHash || "") + action + JSON.stringify(details) + createdAt.toISOString();
  const entryHash = crypto.createHash("sha256").update(body).digest("hex");
  return prisma.auditLog.create({
    data: { studyId, actorRole, actorId, action, details, prevHash: prev?.entryHash || null, entryHash }
  });
}

const uploadDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const tag = Date.now() + "-" + crypto.randomBytes(4).toString("hex");
    cb(null, `${tag}--${safe}`);
  }
});

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 10);
const uploadMw = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

async function isEnrolled(studyId, participantId) {
  const e = await prisma.enrollment.findUnique({
    where: { studyId_participantId: { studyId, participantId } }
  });
  return !!e;
}

/** Render the receipt as a clean PDF (no site chrome) */
async function renderReceiptPdf(res, study, consent, filenameBase, nowIso) {
  return new Promise((resolve, reject) => {
    res.render(
      "receipt_print",
      {
        layout: false,                // <- critical: render without app layout
        study,
        consent,
        user: res.req.session.user,
        nowIso: nowIso || new Date().toISOString()
      },
      async (err, html) => {
        if (err) return reject(err);
        try {
          const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: "networkidle0" });
          const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm" }
          });
          await browser.close();
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
          res.end(pdf);
          resolve();
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

/* ---------------------------------- views --------------------------------- */

// View a study
router.get("/s/:slug", requireLogin, async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: { orderBy: { createdAt: "asc" } } }
  });
  if (!study) return res.status(404).send("Study not found");

  // Researcher can only view own study
  if (req.session.user.role === "researcher" && study.ownerId !== req.session.user.id) {
    return res.status(403).send("Forbidden");
  }
  // Participants can view any non-draft study (invite can be viewed even if not enrolled)
  if (req.session.user.role === "participant" && study.status === "draft") {
    return res.status(403).send("This study is not public.");
  }

  let latestConsent = null;
  let myUploads = [];
  let enrolled = false;

  if (req.session.user.role === "participant") {
    enrolled = await isEnrolled(study.id, req.session.user.id);

    latestConsent = await prisma.consent.findFirst({
      where: { studyId: study.id, participantId: req.session.user.id },
      orderBy: { version: "desc" },
      include: { choices: true }
    });

    // Uploads are hidden in the UI, but keeping fetch in case you re-enable
    myUploads = await prisma.upload.findMany({
      where: { studyId: study.id, participantId: req.session.user.id, deletedAt: null },
      include: { category: true },
      orderBy: { createdAt: "desc" }
    });
  }

  res.render("study_view", {
    title: study.title,
    user: req.session.user,
    study,
    latestConsent,
    myUploads,
    enrolled,
    notice: null,
    error: null
  });
});

/* ---------------------------- enroll / unenroll --------------------------- */

// Enroll (public or invite). If invite & a join code is set, require it.
router.post("/s/:slug/enroll", requireAuth("participant"), async (req, res) => {
  const study = await prisma.study.findUnique({ where: { slug: req.params.slug } });
  if (!study) return res.status(404).send("Study not found");

  const codeSupplied = (req.body?.code || "").trim();
  const codeSet = (study.joinCode || "").trim();

  if ((study.status || "").toLowerCase() === "invite" && codeSet) {
    if (codeSupplied.toUpperCase() !== codeSet.toUpperCase()) {
      // Render back with inline error
      return res.render("study_view", {
        title: study.title,
        user: req.session.user,
        study,
        latestConsent: null,
        myUploads: [],
        enrolled: false,
        notice: null,
        error: "Invalid join code."
      });
    }
  }

  await prisma.enrollment.upsert({
    where: { studyId_participantId: { studyId: study.id, participantId: req.session.user.id } },
    create: { studyId: study.id, participantId: req.session.user.id },
    update: {}
  });
  await addAudit(study.id, "participant", req.session.user.id, "ENROLLED", { via: "study_page" });

  res.redirect(`/s/${study.slug}`);
});

// Unenroll (allowed regardless of study status)
router.post("/s/:slug/unenroll", requireAuth("participant"), async (req, res) => {
  const study = await prisma.study.findUnique({ where: { slug: req.params.slug } });
  if (!study) return res.status(404).send("Study not found");

  await prisma.enrollment.deleteMany({
    where: { studyId: study.id, participantId: req.session.user.id }
  });
  await addAudit(study.id, "participant", req.session.user.id, "UNENROLLED", { via: "study_page" });

  res.redirect(`/s/${study.slug}`);
});

/* --------------------------- consent / withdraw --------------------------- */

// Save choices (always allowed; versions receipts)
router.post("/s/:slug/consent", requireAuth("participant"), async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: true }
  });
  if (!study) return res.status(404).send("Study not found");

  const decisions = study.categories.map(c => {
    const allowed = c.required ? true : Boolean(req.body[`cat_${c.id}`]);
    return { categoryId: c.id, allowed };
  });

  const prev = await prisma.consent.findFirst({
    where: { studyId: study.id, participantId: req.session.user.id },
    orderBy: { version: "desc" }
  });
  const version = prev ? prev.version + 1 : 1;
  const granted = decisions.some(d => d.allowed);

  const base = {
    receipt_version: 1,
    study: { slug: study.slug, title: study.title, version: study.version, contact: study.contactEmail },
    participant: { pseudonymous_id: req.session.user.id },
    decisions: decisions.map(d => {
      const cat = study.categories.find(c => c.id === d.categoryId);
      return { category: cat?.name || d.categoryId, allowed: d.allowed };
    }),
    retention: { default_days: study.retentionDefaultDays },
    effective_at: new Date().toISOString(),
    withdrawal: null
  };
  const hash = crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex");

  await prisma.$transaction(async tx => {
    await tx.consent.create({
      data: {
        studyId: study.id,
        participantId: req.session.user.id,
        version,
        granted,
        withdrawnAt: null,
        receiptHash: `sha256:${hash}`,
        receiptJson: { ...base, receipt_hash: `sha256:${hash}` },
        choices: { create: decisions.map(d => ({ categoryId: d.categoryId, allowed: d.allowed })) }
      }
    });
    await addAudit(study.id, "participant", req.session.user.id, prev ? "CONSENT_EDITED" : "CONSENT_GIVEN", {
      version,
      granted,
      decisions
    });
  });

  const [latestConsent, myUploads, enrolled] = await Promise.all([
    prisma.consent.findFirst({
      where: { studyId: study.id, participantId: req.session.user.id },
      orderBy: { version: "desc" },
      include: { choices: true }
    }),
    prisma.upload.findMany({
      where: { studyId: study.id, participantId: req.session.user.id, deletedAt: null },
      include: { category: true },
      orderBy: { createdAt: "desc" }
    }),
    isEnrolled(study.id, req.session.user.id)
  ]);

  res.render("study_view", {
    title: study.title,
    user: req.session.user,
    study,
    latestConsent,
    myUploads,
    enrolled,
    notice: `Choices saved (v${version}).`,
    error: null
  });
});

// Withdraw (deny all)
router.post("/s/:slug/withdraw", requireAuth("participant"), async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: true }
  });
  if (!study) return res.status(404).send("Study not found");

  const decisions = study.categories.map(c => ({ categoryId: c.id, allowed: false }));
  const prev = await prisma.consent.findFirst({
    where: { studyId: study.id, participantId: req.session.user.id },
    orderBy: { version: "desc" }
  });
  const version = prev ? prev.version + 1 : 1;

  const nowIso = new Date().toISOString();
  const base = {
    receipt_version: 1,
    study: { slug: study.slug, title: study.title, version: study.version, contact: study.contactEmail },
    participant: { pseudonymous_id: req.session.user.id },
    decisions: decisions.map(d => {
      const cat = study.categories.find(c => c.id === d.categoryId);
      return { category: cat?.name || d.categoryId, allowed: d.allowed };
    }),
    retention: { default_days: study.retentionDefaultDays },
    effective_at: nowIso,
    withdrawal: nowIso
  };
  const hash = crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex");

  await prisma.$transaction(async tx => {
    await tx.consent.create({
      data: {
        studyId: study.id,
        participantId: req.session.user.id,
        version,
        granted: false,
        withdrawnAt: new Date(nowIso),
        receiptHash: `sha256:${hash}`,
        receiptJson: { ...base, receipt_hash: `sha256:${hash}` },
        choices: { create: decisions.map(d => ({ categoryId: d.categoryId, allowed: d.allowed })) }
      }
    });
    await addAudit(study.id, "participant", req.session.user.id, "WITHDRAWN", { version });
  });

  const [latestConsent, myUploads, enrolled] = await Promise.all([
    prisma.consent.findFirst({
      where: { studyId: study.id, participantId: req.session.user.id },
      orderBy: { version: "desc" },
      include: { choices: true }
    }),
    prisma.upload.findMany({
      where: { studyId: study.id, participantId: req.session.user.id, deletedAt: null },
      include: { category: true },
      orderBy: { createdAt: "desc" }
    }),
    isEnrolled(study.id, req.session.user.id)
  ]);

  res.render("study_view", {
    title: study.title,
    user: req.session.user,
    study,
    latestConsent,
    myUploads,
    enrolled,
    notice: `Consent withdrawn (v${version}).`,
    error: null
  });
});

/* ----------------------------- history + diff ----------------------------- */

// List all saved versions for this participant
router.get("/s/:slug/history", requireAuth("participant"), async (req, res, next) => {
  try {
    const study = await prisma.study.findUnique({ where: { slug: req.params.slug } });
    if (!study) {
      return res.status(404).render("404", { title: "Not found", user: req.session?.user || null });
    }

    const consents = await prisma.consent.findMany({
      where: { studyId: study.id, participantId: req.session.user.id },
      orderBy: { version: "desc" },
      include: { choices: true }
    });

    res.render("history", {
      title: `Consent history — ${study.title}`,
      user: req.session.user,
      study,
      consents
    });
  } catch (e) {
    next(e);
  }
});

// Compare two versions
router.get("/s/:slug/history/diff", requireAuth("participant"), async (req, res, next) => {
  try {
    const v1 = Number(req.query.v1);
    const v2 = Number(req.query.v2);

    const study = await prisma.study.findUnique({
      where: { slug: req.params.slug },
      include: { categories: true }
    });
    if (!study || !Number.isInteger(v1) || !Number.isInteger(v2)) {
      return res.status(400).render("500", {
        title: "Error",
        user: req.session?.user || null,
        message: "Bad versions"
      });
    }

    const [c1, c2] = await Promise.all([
      prisma.consent.findFirst({
        where: { studyId: study.id, participantId: req.session.user.id, version: v1 },
        include: { choices: true }
      }),
      prisma.consent.findFirst({
        where: { studyId: study.id, participantId: req.session.user.id, version: v2 },
        include: { choices: true }
      })
    ]);
    if (!c1 || !c2) {
      return res.status(404).render("404", { title: "Not found", user: req.session?.user || null });
    }

    const byId1 = new Map(c1.choices.map(ch => [ch.categoryId, ch.allowed]));
    const byId2 = new Map(c2.choices.map(ch => [ch.categoryId, ch.allowed]));
    const rows = study.categories.map(cat => {
      const a = byId1.has(cat.id) ? (byId1.get(cat.id) ? "Allowed" : "Denied") : "—";
      const b = byId2.has(cat.id) ? (byId2.get(cat.id) ? "Allowed" : "Denied") : "—";
      return { name: cat.name, a, b, changed: a !== b };
    });

    res.render("history_diff", {
      title: `Diff v${v1} → v${v2}: ${study.title}`,
      user: req.session.user,
      study,
      v1,
      v2,
      c1,
      c2,
      rows
    });
  } catch (e) {
    next(e);
  }
});

/* -------------------------------- receipts -------------------------------- */

router.get("/s/:slug/receipt/latest", requireAuth("participant"), async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: true }
  });
  if (!study) return res.status(404).send("Study not found");

  const latest = await prisma.consent.findFirst({
    where: { studyId: study.id, participantId: req.session.user.id },
    orderBy: { version: "desc" },
    include: { choices: true }
  });
  if (!latest) return res.status(404).send("No receipt available. Save choices first.");

  await addAudit(study.id, "participant", req.session.user.id, "RECEIPT_DOWNLOADED", {
    version: latest.version,
    format: "pdf"
  });

  const filename = `receipt-${study.slug}-v${latest.version}`;
  try {
    await renderReceiptPdf(res, study, latest, filename);
  } catch (e) {
    console.error("[receipt latest → pdf]", e);
    res.status(500).send("Failed to generate PDF");
  }
});

router.get("/s/:slug/receipt/:version", requireAuth("participant"), async (req, res) => {
  const version = Number(req.params.version);
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: true }
  });
  if (!study || !Number.isInteger(version)) return res.status(404).send("Not found");

  const consent = await prisma.consent.findFirst({
    where: { studyId: study.id, participantId: req.session.user.id, version },
    include: { choices: true }
  });
  if (!consent) return res.status(404).send("Receipt not found");

  await addAudit(study.id, "participant", req.session.user.id, "RECEIPT_DOWNLOADED", {
    version: consent.version,
    format: "pdf"
  });

  const filename = `receipt-${study.slug}-v${consent.version}`;
  try {
    await renderReceiptPdf(res, study, consent, filename);
  } catch (e) {
    console.error("[receipt :version → pdf]", e);
    res.status(500).send("Failed to generate PDF");
  }
});

/* --------------------------------- uploads -------------------------------- */

// (UI currently hidden on the page but API remains)
router.post("/s/:slug/upload", requireAuth("participant"), uploadMw.single("file"), async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: true }
  });
  if (!study) return res.status(404).send("Study not found");
  if (!req.file) return res.status(400).send("No file uploaded.");

  const categoryId = req.body.categoryId;
  const category = study.categories.find(c => c.id === categoryId);
  if (!category) {
    await fsp.unlink(req.file.path).catch(() => {});
    return res.status(400).send("Invalid category.");
  }

  // Must have consent unless category is required
  const latest = await prisma.consent.findFirst({
    where: { studyId: study.id, participantId: req.session.user.id },
    orderBy: { version: "desc" },
    include: { choices: true }
  });
  const allowed =
    category.required || (latest && latest.choices.find(ch => ch.categoryId === categoryId && ch.allowed));
  if (!allowed) {
    await fsp.unlink(req.file.path).catch(() => {});
    return res.status(403).send("Upload not permitted for this category without consent.");
  }

  const buf = await fsp.readFile(req.file.path);
  const safety = await checkFileSafety({
    buffer: buf,
    originalName: req.file.originalname,
    fallbackMime: req.file.mimetype
  });
  if (!safety.ok) {
    await fsp.unlink(req.file.path).catch(() => {});
    return res.status(415).send(`Unsupported or unsafe file type. (got: ${safety.usedMime || "unknown"})`);
  }

  const checksum = crypto.createHash("sha256").update(buf).digest("hex");

  const row = await prisma.upload.create({
    data: {
      studyId: study.id,
      participantId: req.session.user.id,
      categoryId,
      originalName: req.file.originalname,
      filename: req.file.filename,
      mime: safety.usedMime || req.file.mimetype,
      sizeBytes: req.file.size,
      checksum,
      storagePath: path.join("uploads", req.file.filename)
    },
    include: { category: true }
  });
  await addAudit(study.id, "participant", req.session.user.id, "FILE_UPLOADED", {
    uploadId: row.id,
    category: row.category.name,
    size: row.sizeBytes,
    mime: row.mime
  });

  res.redirect(`/s/${study.slug}`);
});

router.get("/uploads/:id/download", requireLogin, async (req, res) => {
  const up = await prisma.upload.findUnique({
    where: { id: req.params.id },
    include: { study: true }
  });
  if (!up || up.deletedAt) return res.status(404).send("Not found");

  const user = req.session.user;
  const isOwnerParticipant = user.role === "participant" && user.id === up.participantId;
  const isOwnerResearcher = user.role === "researcher" && user.id === up.study.ownerId;
  if (!isOwnerParticipant && !isOwnerResearcher) return res.status(403).send("Forbidden");

  const abs = path.join(process.cwd(), "uploads", up.filename);
  res.download(abs, up.originalName);
});

router.post("/uploads/:id/delete", requireAuth("participant"), async (req, res) => {
  const up = await prisma.upload.findUnique({
    where: { id: req.params.id },
    include: { study: true }
  });
  if (!up || up.deletedAt) return res.status(404).send("Not found");
  if (up.participantId !== req.session.user.id) return res.status(403).send("Forbidden");

  const abs = path.join(process.cwd(), "uploads", up.filename);
  await fsp.unlink(abs).catch(() => {});
  await prisma.upload.update({ where: { id: up.id }, data: { deletedAt: new Date() } });
  await addAudit(up.studyId, "participant", req.session.user.id, "FILE_DELETED", { uploadId: up.id });

  res.redirect(`/s/${up.study.slug}`);
});

export default router;
