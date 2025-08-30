// src/lib/export_excel.js
import ExcelJS from "exceljs";
import { prisma } from "./prisma.js";
import { pseudonym } from "./pseudo.js";

function autoSizeColumns(ws) {
  ws.columns.forEach(col => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, c => {
      const v = String(c.value ?? "");
      if (v.length > max) max = Math.min(60, v.length + 2);
    });
    col.width = max;
  });
}

// Style + freeze header row safely even when header is not row 1
function styleHeader(ws, headerRowNumber = 1) {
  const row = ws.getRow(headerRowNumber);
  row.font = { bold: true };
  row.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: headerRowNumber }];
  const lastCol = row.cellCount || ws.columnCount || 1;
  ws.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: lastCol }
  };
}

/* ------------------------------ Full workbook ------------------------------ */
export async function buildStudyWorkbook(ownerId, slug) {
  const study = await prisma.study.findUnique({
    where: { slug },
    include: { categories: { orderBy: { createdAt: "asc" } } }
  });
  if (!study) throw Object.assign(new Error("Study not found"), { statusCode: 404 });
  if (study.ownerId !== ownerId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const [consents, uploads, audits, purges] = await Promise.all([
    prisma.consent.findMany({
      where: { studyId: study.id },
      orderBy: [{ participantId: "asc" }, { version: "desc" }],
      include: { choices: true }
    }),
    prisma.upload.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: "desc" },
      include: { category: true }
    }),
    prisma.auditLog.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: "asc" }
    }),
    prisma.auditLog.findMany({
      where: { studyId: study.id, action: "RETENTION_PURGE" },
      orderBy: { createdAt: "asc" }
    })
  ]);

  // latest consent per participant
  const latestByPid = new Map();
  for (const c of consents) {
    const prev = latestByPid.get(c.participantId);
    if (!prev || c.version > prev.version) latestByPid.set(c.participantId, c);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Consent Manager";
  wb.created = new Date();

  /* Overview */
  {
    const ws = wb.addWorksheet("Overview");
    ws.addRow(["Title", study.title]);
    ws.addRow(["Slug", study.slug]);
    ws.addRow(["Status", study.status]);
    ws.addRow(["Join code (invite)", study.status === "invite" ? (study.joinCode || "—") : "—"]);
    ws.addRow(["Default retention (days)", study.retentionDefaultDays ?? "—"]);
    ws.addRow([]);
    ws.addRow(["Categories"]);
    const headerRowNum = ws.addRow(["Name", "Required", "Retention (days)", "Description"]).number;
    styleHeader(ws, headerRowNum);
    for (const c of study.categories) {
      ws.addRow([c.name, c.required ? "Yes" : "No", c.retentionDays ?? (study.retentionDefaultDays ?? "—"), c.description || ""]);
    }
    autoSizeColumns(ws);
  }

  /* Participants */
  {
    const ws = wb.addWorksheet("Participants");
    const catHeaders = study.categories.map(c => c.name);
    const headerRowNum = ws.addRow(["Participant", "Version", "Granted", "Created At", "Withdrawn At", ...catHeaders, "Upload Count", "Last Activity"]).number;
    styleHeader(ws, headerRowNum);

    // Upload stats
    const uploadsByPid = new Map();
    const lastUploadAt = new Map();
    for (const u of uploads) {
      uploadsByPid.set(u.participantId, (uploadsByPid.get(u.participantId) || 0) + 1);
      const prev = lastUploadAt.get(u.participantId);
      if (!prev || u.createdAt > prev) lastUploadAt.set(u.participantId, u.createdAt);
    }

    for (const [pid, c] of latestByPid.entries()) {
      const pseudo = pseudonym(study.id, pid);
      const perCat = new Map(c.choices.map(ch => [ch.categoryId, ch.allowed]));
      const cols = study.categories.map(cat => (cat.required ? "Required" : (perCat.get(cat.id) ? "Allowed" : "Denied")));
      const uploadsCount = uploadsByPid.get(pid) || 0;
      const lastAct = new Date(
        Math.max(
          c.createdAt?.getTime?.() || new Date(c.createdAt).getTime(),
          lastUploadAt.get(pid)?.getTime?.() || new Date(lastUploadAt.get(pid) || 0).getTime()
        )
      );
      ws.addRow([
        pseudo,
        c.version,
        c.granted ? "Yes" : "No",
        c.createdAt || "",
        c.withdrawnAt || "",
        ...cols,
        uploadsCount,
        uploadsCount ? lastAct : ""
      ]);
    }

    const createdAtCol = 4;
    const withdrawnAtCol = 5;
    const lastActivityCol = 5 + catHeaders.length + 2;
    ws.getColumn(createdAtCol).numFmt = "yyyy-mm-dd hh:mm";
    ws.getColumn(withdrawnAtCol).numFmt = "yyyy-mm-dd hh:mm";
    ws.getColumn(lastActivityCol).numFmt = "yyyy-mm-dd hh:mm";
    autoSizeColumns(ws);
  }

  /* Uploads */
  {
    const ws = wb.addWorksheet("Uploads");
    const headerRowNum = ws.addRow(["When", "Participant", "Category", "File name", "MIME", "Size (MB)", "Checksum"]).number;
    styleHeader(ws, headerRowNum);
    for (const u of uploads) {
      ws.addRow([
        u.createdAt,
        pseudonym(study.id, u.participantId),
        u.category?.name || u.categoryId,
        u.originalName,
        u.mime,
        +(u.sizeBytes / 1024 / 1024).toFixed(2),
        u.checksum
      ]);
    }
    ws.getColumn(1).numFmt = "yyyy-mm-dd hh:mm";
    ws.getColumn(6).numFmt = "0.00";
    autoSizeColumns(ws);
  }

  /* Audit */
  {
    const ws = wb.addWorksheet("Audit");
    const headerRowNum = ws.addRow(["Time", "Actor role", "Actor id", "Action", "Details", "Prev hash", "Entry hash"]).number;
    styleHeader(ws, headerRowNum);
    for (const r of audits) {
      ws.addRow([
        r.createdAt,
        r.actorRole,
        r.actorId || "",
        r.action,
        JSON.stringify(r.details || {}),
        r.prevHash || "",
        r.entryHash || ""
      ]);
    }
    ws.getColumn(1).numFmt = "yyyy-mm-dd hh:mm";
    autoSizeColumns(ws);
  }

  /* Retention */
  {
    const ws = wb.addWorksheet("Retention");
    const headerRowNum = ws.addRow(["Time", "UploadId", "Category", "Upload Created", "Retention (days)"]).number;
    styleHeader(ws, headerRowNum);
    const purges = await prisma.auditLog.findMany({
      where: { studyId: study.id, action: "RETENTION_PURGE" },
      orderBy: { createdAt: "asc" }
    });
    for (const r of purges) {
      const d = r.details || {};
      ws.addRow([
        r.createdAt,
        d.uploadId || "",
        d.category || "",
        d.createdAt ? new Date(d.createdAt) : "",
        d.retentionDays ?? ""
      ]);
    }
    ws.getColumn(1).numFmt = "yyyy-mm-dd hh:mm";
    ws.getColumn(4).numFmt = "yyyy-mm-dd hh:mm";
    autoSizeColumns(ws);
  }

  return { wb, study };
}

/* -------------------------- Participants-only workbook -------------------- */
export async function buildParticipantsWorkbook(ownerId, slug) {
  const study = await prisma.study.findUnique({
    where: { slug },
    include: { categories: { orderBy: { createdAt: "asc" } } }
  });
  if (!study) throw Object.assign(new Error("Study not found"), { statusCode: 404 });
  if (study.ownerId !== ownerId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const [consents, uploads] = await Promise.all([
    prisma.consent.findMany({
      where: { studyId: study.id },
      orderBy: [{ participantId: "asc" }, { version: "desc" }],
      include: { choices: true }
    }),
    prisma.upload.findMany({
      where: { studyId: study.id, deletedAt: null },
      orderBy: { createdAt: "desc" }
    })
  ]);

  // latest consent per participant
  const latestByPid = new Map();
  for (const c of consents) {
    const prev = latestByPid.get(c.participantId);
    if (!prev || c.version > prev.version) latestByPid.set(c.participantId, c);
  }

  // upload stats
  const uploadsByPid = new Map();
  const lastUploadAt = new Map();
  for (const u of uploads) {
    uploadsByPid.set(u.participantId, (uploadsByPid.get(u.participantId) || 0) + 1);
    const prev = lastUploadAt.get(u.participantId);
    if (!prev || u.createdAt > prev) lastUploadAt.set(u.participantId, u.createdAt);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Consent Manager";
  wb.created = new Date();

  const ws = wb.addWorksheet("Participants");
  const catHeaders = study.categories.map(c => c.name);
  const headerRowNum = ws.addRow(["Participant", "Version", "Granted", "Created At", "Withdrawn At", ...catHeaders, "Upload Count", "Last Activity"]).number;
  styleHeader(ws, headerRowNum);

  for (const [pid, c] of latestByPid.entries()) {
    const pseudo = pseudonym(study.id, pid);
    const perCat = new Map(c.choices.map(ch => [ch.categoryId, ch.allowed]));
    const cols = study.categories.map(cat => (cat.required ? "Required" : (perCat.get(cat.id) ? "Allowed" : "Denied")));
    const uploadsCount = uploadsByPid.get(pid) || 0;
    const lastAct = new Date(
      Math.max(
        c.createdAt?.getTime?.() || new Date(c.createdAt).getTime(),
        lastUploadAt.get(pid)?.getTime?.() || new Date(lastUploadAt.get(pid) || 0).getTime()
      )
    );
    ws.addRow([
      pseudo,
      c.version,
      c.granted ? "Yes" : "No",
      c.createdAt || "",
      c.withdrawnAt || "",
      ...cols,
      uploadsCount,
      uploadsCount ? lastAct : ""
    ]);
  }

  const createdAtCol = 4;
  const withdrawnAtCol = 5;
  const lastActivityCol = 5 + catHeaders.length + 2;
  ws.getColumn(createdAtCol).numFmt = "yyyy-mm-dd hh:mm";
  ws.getColumn(withdrawnAtCol).numFmt = "yyyy-mm-dd hh:mm";
  ws.getColumn(lastActivityCol).numFmt = "yyyy-mm-dd hh:mm";
  autoSizeColumns(ws);

  return { wb, study };
}
