// src/lib/export_pdf.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import puppeteer from "puppeteer";
import { prisma } from "./prisma.js";
import { pseudonym } from "./pseudo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VIEWS = path.join(__dirname, "../views");

export async function buildStudyPdf(ownerId, slug) {
  const study = await prisma.study.findUnique({
    where: { slug },
    include: { categories: { orderBy: { createdAt: "asc" } } }
  });
  if (!study) throw Object.assign(new Error("Study not found"), { statusCode: 404 });
  if (study.ownerId !== ownerId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const [consents, uploads, purges] = await Promise.all([
    prisma.consent.findMany({ where: { studyId: study.id }, include: { choices: true } }),
    prisma.upload.findMany({ where: { studyId: study.id }, include: { category: true } }),
    prisma.auditLog.findMany({ where: { studyId: study.id, action: "RETENTION_PURGE" } })
  ]);

  // Aggregate counts per category
  const latestByPid = new Map();
  for (const c of consents) {
    const prev = latestByPid.get(c.participantId);
    if (!prev || c.version > prev.version) latestByPid.set(c.participantId, c);
  }
  const catAgg = study.categories.map(cat => ({ cat, allowed: 0, denied: 0, required: cat.required ? "Required" : "" }));
  for (const [, c] of latestByPid.entries()) {
    const map = new Map(c.choices.map(ch => [ch.categoryId, ch.allowed]));
    for (const row of catAgg) {
      if (row.cat.required) { /* nothing to count */ }
      else if (map.get(row.cat.id)) row.allowed++;
      else row.denied++;
    }
  }

  const html = await ejs.renderFile(path.join(VIEWS, "export_study.ejs"), {
    study,
    catAgg,
    participantCount: latestByPid.size,
    uploads,
    pseudonym: (pid) => pseudonym(study.id, pid),
    purges
  }, { rmWhitespace: true });

  const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;margin-left:12mm;">Study: ${study.title}</div>`,
      footerTemplate: `<div style="font-size:8px; margin:0 12mm; width:100%; display:flex; justify-content:space-between;">
        <span class="date"></span><span class="pageNumber"></span>/<span class="totalPages"></span>
      </div>`
    });
    return { pdf, study };
  } finally {
    await browser.close();
  }
}
