import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/mw.js";
import { slugify } from "../lib/strings.js";
import { pseudonym } from "../lib/pseudo.js";
import { genJoinCode } from "../lib/code.js";
import { buildStudyWorkbook, buildParticipantsWorkbook } from "../lib/export_excel.js";

const router = Router();

/* ------------------------------- Dashboard ------------------------------- */

router.get("/researcher", requireAuth("researcher"), async (req, res) => {
  const studies = await prisma.study.findMany({
    where: { ownerId: req.session.user.id },
    orderBy: { createdAt: "desc" },
    include: { categories: true }
  });
  res.render("researcher_studies", { title: "Your studies", user: req.session.user, studies });
});

/* ------------------------------- Create study ---------------------------- */

router.get("/researcher/studies/new", requireAuth("researcher"), (req, res) => {
  res.render("study_new", { title: "Create study", user: req.session.user, error: null, values: {} });
});

const StudyCreateSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  purpose: z.string().min(1),
  contactEmail: z.string().email(),
  retentionDays: z.string().optional(),
  status: z.enum(["draft", "public", "invite"]).default("public"),
  joinCode: z.string().optional(),
  c1_name: z.string().optional(),
  c1_desc: z.string().optional(),
  c1_req: z.string().optional(),
  c1_ret: z.string().optional(),
  c2_name: z.string().optional(),
  c2_desc: z.string().optional(),
  c2_req: z.string().optional(),
  c2_ret: z.string().optional(),
  c3_name: z.string().optional(),
  c3_desc: z.string().optional(),
  c3_req: z.string().optional(),
  c3_ret: z.string().optional()
});

router.post("/researcher/studies/new", requireAuth("researcher"), async (req, res) => {
  const parsed = StudyCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("study_new", { title: "Create study", user: req.session.user, error: "Invalid input.", values: req.body });
  }
  const {
    title, summary, purpose, contactEmail, retentionDays, status, joinCode,
    c1_name, c1_desc, c1_req, c1_ret,
    c2_name, c2_desc, c2_req, c2_ret,
    c3_name, c3_desc, c3_req, c3_ret
  } = parsed.data;

  const slug = slugify(title);
  const ensureJoin = status === "invite" ? (joinCode?.trim().toUpperCase() || genJoinCode()) : null;

  try {
    await prisma.study.create({
      data: {
        ownerId: req.session.user.id,
        slug,
        title,
        summary,
        purpose,
        contactEmail,
        retentionDefaultDays: retentionDays ? Number(retentionDays) : null,
        status,
        joinCode: ensureJoin,
        categories: {
          create: [
            { name: c1_name || "Email",         description: c1_desc || "", required: !!c1_req, retentionDays: c1_ret ? Number(c1_ret) : null },
            { name: c2_name || "Usage Logs",    description: c2_desc || "", required: !!c2_req, retentionDays: c2_ret ? Number(c2_ret) : null },
            { name: c3_name || "Accelerometer", description: c3_desc || "", required: !!c3_req, retentionDays: c3_ret ? Number(c3_ret) : null }
          ]
        }
      }
    });
    return res.redirect("/researcher");
  } catch (e) {
    console.error(e);
    const msg = e.code === "P2002" ? "A study with a similar slug/title already exists." : "Unexpected error.";
    return res.render("study_new", { title: "Create study", user: req.session.user, error: msg, values: req.body });
  }
});

/* -------------------------------- Edit study ---------------------------- */

router.get("/researcher/studies/:slug/edit", requireAuth("researcher"), async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: { orderBy: { createdAt: "asc" } } }
  });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");
  res.render("study_edit", { title: `Edit: ${study.title}`, user: req.session.user, error: null, study, cats: study.categories });
});

const StudyEditSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  purpose: z.string().min(1),
  contactEmail: z.string().email(),
  retentionDays: z.string().optional(),
  status: z.enum(["draft", "public", "invite"]),
  joinCode: z.string().optional(),
  c1_id: z.string().min(1),
  c1_name: z.string().min(1),
  c1_desc: z.string().optional(),
  c1_req: z.string().optional(),
  c1_ret: z.string().optional(),
  c2_id: z.string().min(1),
  c2_name: z.string().min(1),
  c2_desc: z.string().optional(),
  c2_req: z.string().optional(),
  c2_ret: z.string().optional(),
  c3_id: z.string().min(1),
  c3_name: z.string().min(1),
  c3_desc: z.string().optional(),
  c3_req: z.string().optional(),
  c3_ret: z.string().optional()
});

router.post("/researcher/studies/:slug/edit", requireAuth("researcher"), async (req, res) => {
  const study = await prisma.study.findUnique({ where: { slug: req.params.slug }, include: { categories: true } });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");

  const parsed = StudyEditSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("study_edit", { title: `Edit: ${study.title}`, user: req.session.user, error: "Invalid input.", study, cats: study.categories });
  }
  const {
    title, summary, purpose, contactEmail, retentionDays, status, joinCode,
    c1_id, c1_name, c1_desc, c1_req, c1_ret,
    c2_id, c2_name, c2_desc, c2_req, c2_ret,
    c3_id, c3_name, c3_desc, c3_req, c3_ret
  } = parsed.data;

  try {
    await prisma.$transaction([
      prisma.study.update({
        where: { id: study.id },
        data: {
          title,
          summary,
          purpose,
          contactEmail,
          retentionDefaultDays: retentionDays ? Number(retentionDays) : null,
          status,
          joinCode: status === "invite" ? (joinCode?.trim().toUpperCase() || study.joinCode || genJoinCode()) : null
        }
      }),
      prisma.dataCategory.update({ where: { id: c1_id }, data: { name: c1_name, description: c1_desc ?? "", required: !!c1_req, retentionDays: c1_ret ? Number(c1_ret) : null } }),
      prisma.dataCategory.update({ where: { id: c2_id }, data: { name: c2_name, description: c2_desc ?? "", required: !!c2_req, retentionDays: c2_ret ? Number(c2_ret) : null } }),
      prisma.dataCategory.update({ where: { id: c3_id }, data: { name: c3_name, description: c3_desc ?? "", required: !!c3_req, retentionDays: c3_ret ? Number(c3_ret) : null } }),
      prisma.auditLog.create({
        data: {
          studyId: study.id,
          actorRole: "researcher",
          actorId: req.session.user.id,
          action: "STUDY_UPDATED",
          details: { status, joinCode: status === "invite" ? (joinCode || study.joinCode) : null }
        }
      })
    ]);
    return res.redirect("/researcher");
  } catch (e) {
    console.error(e);
    return res.render("study_edit", { title: `Edit: ${study.title}`, user: req.session.user, error: "Failed to update study.", study, cats: study.categories });
  }
});

/* ----------------------- Join code regenerate (invite) ------------------- */

router.post("/researcher/studies/:slug/joincode/regenerate", requireAuth("researcher"), async (req, res) => {
  const study = await prisma.study.findUnique({ where: { slug: req.params.slug } });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");
  if (study.status !== "invite") return res.status(400).send("Join code applies only to invite studies.");

  const newCode = genJoinCode();
  await prisma.$transaction([
    prisma.study.update({ where: { id: study.id }, data: { joinCode: newCode } }),
    prisma.auditLog.create({
      data: {
        studyId: study.id,
        actorRole: "researcher",
        actorId: req.session.user.id,
        action: "JOIN_CODE_REGENERATED",
        details: {}
      }
    })
  ]);
  res.redirect(`/researcher/studies/${study.slug}/edit`);
});

/* ------------------------ Participants console (views) ------------------- */

router.get("/researcher/studies/:slug/participants", requireAuth("researcher"), async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: { orderBy: { createdAt: "asc" } } }
  });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");

  const consents = await prisma.consent.findMany({
    where: { studyId: study.id },
    orderBy: [{ participantId: "asc" }, { version: "desc" }],
    include: { choices: true }
  });

  const uploads = await prisma.upload.findMany({
    where: { studyId: study.id, deletedAt: null },
    select: { participantId: true, createdAt: true }
  });

  const latestByParticipant = new Map();
  for (const c of consents) {
    const prev = latestByParticipant.get(c.participantId);
    if (!prev || c.version > prev.version) latestByParticipant.set(c.participantId, c);
  }

  const uploadCounts = new Map();
  const lastUploadAt = new Map();
  for (const u of uploads) {
    uploadCounts.set(u.participantId, (uploadCounts.get(u.participantId) || 0) + 1);
    const prev = lastUploadAt.get(u.participantId);
    if (!prev || u.createdAt > prev) lastUploadAt.set(u.participantId, u.createdAt);
  }

  const participants = Array.from(latestByParticipant.entries()).map(([pid, c]) => {
    const perCat = new Map(c.choices.map((ch) => [ch.categoryId, ch.allowed]));
    const columns = study.categories.map((cat) => {
      if (cat.required) return "Required";
      const v = perCat.get(cat.id);
      return v === undefined ? "—" : v ? "Allowed" : "Denied";
    });
    const lastActivity = new Date(
      Math.max(new Date(c.createdAt).getTime(), lastUploadAt.get(pid)?.getTime() || 0)
    );
    return {
      participantId: pid,
      pseudo: pseudonym(study.id, pid),
      version: c.version,
      granted: c.granted,
      createdAt: c.createdAt,
      withdrawnAt: c.withdrawnAt,
      columns,
      uploadCount: uploadCounts.get(pid) || 0,
      lastActivity
    };
  });

  res.render("researcher_participants", {
    title: `Participants — ${study.title}`,
    user: req.session.user,
    study,
    categories: study.categories,
    participants
  });
});

/* -------------------- Participants download (Excel, single sheet) -------- */

router.get("/researcher/studies/:slug/participants.csv", requireAuth("researcher"), async (req, res) => {
  try {
    const { wb, study } = await buildParticipantsWorkbook(req.session.user.id, req.params.slug);
    const buffer = await wb.xlsx.writeBuffer();
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="participants-${study.slug}-${ts}.xlsx"`);
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  } catch (e) {
    console.error("[participants.csv→xlsx single-sheet]", e);
    return res.status(e.statusCode || 500).send(e.message || "Export failed");
  }
});

/* ------------------------------ Full export (Excel) ---------------------- */

router.get("/researcher/studies/:slug/export.xlsx", requireAuth("researcher"), async (req, res) => {
  try {
    const { wb, study } = await buildStudyWorkbook(req.session.user.id, req.params.slug);
    const buffer = await wb.xlsx.writeBuffer();
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="study-${study.slug}-${ts}.xlsx"`);
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  } catch (e) {
    console.error("[export.xlsx]", e);
    return res.status(e.statusCode || 500).send(e.message || "Export failed");
  }
});

export default router;
