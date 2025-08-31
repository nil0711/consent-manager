import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/mw.js";
import { slugify } from "../lib/strings.js";
import { pseudonym } from "../lib/pseudo.js";
import { genJoinCode } from "../lib/code.js";
import { buildStudyWorkbook, buildParticipantsWorkbook } from "../lib/export_excel.js";
import crypto from "node:crypto";

const router = Router();

/* ----------------------------- audit helper ------------------------------ */
async function addAudit(studyId, actorRole, actorId, action, details = {}) {
  const prev = await prisma.auditLog.findFirst({
    where: { studyId },
    orderBy: { createdAt: "desc" },
    select: { entryHash: true }
  });
  const createdAt = new Date();
  const body = (prev?.entryHash || "") + action + JSON.stringify(details || {}) + createdAt.toISOString();
  const entryHash = crypto.createHash("sha256").update(body).digest("hex");
  return prisma.auditLog.create({
    data: { studyId, actorRole, actorId, action, details, prevHash: prev?.entryHash || null, entryHash }
  });
}

/* -------------------------------- helpers -------------------------------- */
async function uniqueSlug(base) {
  let s = slugify(base);
  let n = 1;
  while (await prisma.study.findUnique({ where: { slug: s } })) {
    s = `${slugify(base)}-${n++}`;
  }
  return s;
}

// Ensure a study has *at least three* categories; create defaults if missing.
async function ensureThreeCategories(studyId) {
  const cats = await prisma.dataCategory.findMany({
    where: { studyId },
    orderBy: { createdAt: "asc" }
  });

  if (cats.length >= 3) return cats;

  const defaults = [
    { name: "Email", description: "", required: false, retentionDays: null },
    { name: "Usage Logs", description: "", required: true, retentionDays: null },
    { name: "Accelerometer", description: "", required: true, retentionDays: null }
  ];

  const toCreate = [];
  for (let i = cats.length; i < 3; i++) {
    const d = defaults[i] || { name: `Category ${i + 1}`, description: "", required: false, retentionDays: null };
    toCreate.push({ studyId, ...d });
  }
  if (toCreate.length) await prisma.dataCategory.createMany({ data: toCreate });

  return prisma.dataCategory.findMany({ where: { studyId }, orderBy: { createdAt: "asc" } });
}

/* ------------------------------- Dashboard ------------------------------- */

router.get("/researcher", requireAuth("researcher"), async (req, res) => {
  const studies = await prisma.study.findMany({
    where: { ownerId: req.session.user.id },
    orderBy: { createdAt: "desc" },
    include: { categories: true }
  });
  res.render("researcher_studies", {
    title: "Your studies",
    user: req.session.user,
    studies
  });
});

/* ------------------------ Live search (templates API) -------------------- */
router.get("/researcher/api/templates", requireAuth("researcher"), async (req, res) => {
  const q = (req.query.q || "").trim();
  const AND = [
    { NOT: { ownerId: req.session.user.id } },
    { status: { in: ["public", "invite"] } }
  ];
  if (q) {
    AND.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
        { purpose: { contains: q, mode: "insensitive" } },
        { categories: { some: { name: { contains: q, mode: "insensitive" } } } }
      ]
    });
  }
  const rows = await prisma.study.findMany({
    where: { AND },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      slug: true,
      title: true,
      summary: true,
      purpose: true,
      status: true,
      retentionDefaultDays: true,
      categories: { select: { name: true, required: true, retentionDays: true } }
    }
  });
  res.json({ ok: true, rows });
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
    const created = await prisma.study.create({
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
    await addAudit(created.id, "researcher", req.session.user.id, "STUDY_CREATED", { status: created.status });
    return res.redirect("/researcher");
  } catch (e) {
    console.error(e);
    const msg = e.code === "P2002" ? "A study with a similar slug/title already exists." : "Unexpected error.";
    return res.render("study_new", { title: "Create study", user: req.session.user, error: msg, values: req.body });
  }
});

/* ----------------------------- Clone from template ----------------------- */

router.post("/researcher/templates/:slug/clone", requireAuth("researcher"), async (req, res) => {
  const src = await prisma.study.findUnique({
    where: { slug: req.params.slug },
    include: { categories: { orderBy: { createdAt: "asc" } } }
  });
  if (!src || src.ownerId === req.session.user.id) return res.status(404).send("Template not found.");
  if (!["public", "invite"].includes(src.status)) return res.status(403).send("This study is not available to clone.");

  const newTitle = `${src.title} (copy)`;
  const newSlug = await uniqueSlug(`${src.slug}-copy`);

  const srcCats = src.categories || [];
  const fallbackCats = await (async () => {
    if (srcCats.length) return srcCats;
    // if the template oddly has no categories, seed three sensible defaults
    return [
      { name: "Email", description: "", required: false, retentionDays: null },
      { name: "Usage Logs", description: "", required: true, retentionDays: null },
      { name: "Accelerometer", description: "", required: true, retentionDays: null }
    ];
  })();

  try {
    const created = await prisma.study.create({
      data: {
        ownerId: req.session.user.id,
        slug: newSlug,
        title: newTitle,
        summary: src.summary,
        purpose: src.purpose,
        contactEmail: req.session.user.email,
        retentionDefaultDays: src.retentionDefaultDays,
        status: "draft",
        joinCode: null,
        categories: {
          create: fallbackCats.map((c) => ({
            name: c.name,
            description: c.description || "",
            required: !!c.required,
            retentionDays: c.retentionDays ?? null
          }))
        }
      }
    });

    await addAudit(created.id, "researcher", req.session.user.id, "STUDY_CLONED_FROM", {
      fromSlug: src.slug,
      fromOwner: src.ownerId
    });

    // make sure we have 3 cats, then go to edit
    await ensureThreeCategories(created.id);
    return res.redirect(`/researcher/studies/${created.slug}/edit`);
  } catch (e) {
    console.error("[clone template]", e);
    return res.status(500).send("Failed to clone template.");
  }
});

/* -------------------------------- Edit study ---------------------------- */

router.get("/researcher/studies/:slug/edit", requireAuth("researcher"), async (req, res) => {
  const study = await prisma.study.findUnique({
    where: { slug: req.params.slug }
  });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");

  // ✅ guarantee three categories exist before rendering
  const cats = await ensureThreeCategories(study.id);

  res.render("study_edit", {
    title: `Edit: ${study.title}`,
    user: req.session.user,
    error: null,
    study,
    cats
  });
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
  const study = await prisma.study.findUnique({ where: { slug: req.params.slug } });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");

  // strong guarantee ids are present
  const cats = await ensureThreeCategories(study.id);

  const parsed = StudyEditSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("study_edit", {
      title: `Edit: ${study.title}`,
      user: req.session.user,
      error: "Invalid input.",
      study,
      cats
    });
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
      prisma.dataCategory.update({ where: { id: c3_id }, data: { name: c3_name, description: c3_desc ?? "", required: !!c3_req, retentionDays: c3_ret ? Number(c3_ret) : null } })
    ]);

    await addAudit(study.id, "researcher", req.session.user.id, "STUDY_UPDATED", {
      status,
      joinCode: status === "invite" ? (joinCode || study.joinCode) : null
    });

    return res.redirect("/researcher");
  } catch (e) {
    console.error(e);
    const catsRefreshed = await ensureThreeCategories(study.id);
    return res.render("study_edit", {
      title: `Edit: ${study.title}`,
      user: req.session.user,
      error: "Failed to update study.",
      study,
      cats: catsRefreshed
    });
  }
});

/* ----------------------- Join code regenerate (invite) ------------------- */

router.post("/researcher/studies/:slug/joincode/regenerate", requireAuth("researcher"), async (req, res) => {
  const study = await prisma.study.findUnique({ where: { slug: req.params.slug } });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");
  if (study.status !== "invite") return res.status(400).send("Join code applies only to invite studies.");

  const newCode = genJoinCode();
  await prisma.study.update({ where: { id: study.id }, data: { joinCode: newCode } });
  await addAudit(study.id, "researcher", req.session.user.id, "JOIN_CODE_REGENERATED", {});
  res.redirect(`/researcher/studies/${study.slug}/edit`);
});

/* ------------------------------ DELETE study ----------------------------- */

router.post("/researcher/studies/:slug/delete", requireAuth("researcher"), async (req, res) => {
  const study = await prisma.study.findUnique({ where: { slug: req.params.slug } });
  if (!study) return res.status(404).send("Study not found");
  if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");

  await prisma.$transaction([
    prisma.upload.deleteMany({ where: { studyId: study.id } }),
    prisma.consentChoice.deleteMany({ where: { consent: { studyId: study.id } } }),
    prisma.consent.deleteMany({ where: { studyId: study.id } }),
    prisma.enrollment.deleteMany({ where: { studyId: study.id } }),
    prisma.auditLog.deleteMany({ where: { studyId: study.id } }),
    prisma.dataCategory.deleteMany({ where: { studyId: study.id } }),
    prisma.study.delete({ where: { id: study.id } })
  ]);

  return res.redirect("/researcher");
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
router.get(
  "/researcher/studies/:slug/participants/:pid",
  requireAuth("researcher"),
  async (req, res) => {
    const { slug, pid } = req.params;

    // Study + ownership check
    const study = await prisma.study.findUnique({
      where: { slug },
      include: { categories: { orderBy: { createdAt: "asc" } } }
    });
    if (!study) return res.status(404).send("Study not found");
    if (study.ownerId !== req.session.user.id) return res.status(403).send("Forbidden");

    // Latest consent for this participant in this study
    const latest = await prisma.consent.findFirst({
      where: { studyId: study.id, participantId: pid },
      orderBy: { version: "desc" },
      include: { choices: true }
    });

    // Participant’s uploads for this study
    const uploads = await prisma.upload.findMany({
      where: { studyId: study.id, participantId: pid, deletedAt: null },
      include: { category: true },
      orderBy: { createdAt: "desc" }
    });

    return res.render("researcher_participant_detail", {
      title: `Participant — ${study.title}`,
      user: req.session.user,
      study,
      categories: study.categories,
      latest,
      uploads,
      pseudo: pseudonym(study.id, pid)
    });
  }
);

export default router;
