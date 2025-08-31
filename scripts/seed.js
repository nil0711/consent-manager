// scripts/seed.js
// Seed 500 researchers (5–8 studies each), 4000 participants (3–6 enrollments each).
// Adapts to schema: Participant + Consent(join via participantId) OR Consent(userId).
// Ensures consents are "granted" and version-aligned so the UI counts enrollments.

import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import { faker } from "@faker-js/faker";
import pLimit from "p-limit";

const prisma = new PrismaClient({ log: ["warn", "error"] });
const DMMF = Prisma.dmmf;

const models = Object.fromEntries(DMMF.datamodel.models.map(m => [m.name, m]));
const enums  = Object.fromEntries(DMMF.datamodel.enums.map(e => [e.name, e.values]));

function getModel(name) {
  const m = models[name];
  if (!m) throw new Error(`Model "${name}" not in schema.`);
  return m;
}
function relTo(model, target) {
  return model.fields.find(f => f.kind === "object" && f.type === target);
}
function fkFrom(model, target) {
  const r = relTo(model, target);
  return r?.relationFromFields?.[0] || null;
}
function requiredScalars(model) {
  return model.fields.filter(
    f =>
      f.kind === "scalar" &&
      f.isRequired &&
      !f.isId &&
      !f.isUpdatedAt &&
      !f.hasDefaultValue
  );
}
function enumFirst(name) {
  const vals = enums[name];
  return vals?.[0];
}
function randForField(f) {
  const t = f.type;
  const n = f.name.toLowerCase();
  if (n === "version" && t === "Int") return 1; // default version 1 unless overridden
  if (n === "granted" && t === "Boolean") return true;
  if (n === "withdrawn" && t === "Boolean") return false;

  if (t === "String") {
    if (n.includes("email")) return faker.internet.email({ provider: "seed.local" }).toLowerCase();
    if (n.includes("slug"))  return faker.string.alphanumeric({ length: 8 }).toLowerCase();
    if (n.includes("code"))  return faker.string.alphanumeric({ length: 8 }).toUpperCase();
    return faker.lorem.words({ min: 2, max: 5 }).slice(0, 128);
  }
  if (t === "Int")     return faker.number.int({ min: 1, max: 180 });
  if (t === "Float")   return faker.number.float({ min: 0, max: 1, precision: 0.001 });
  if (t === "Boolean") return faker.datatype.boolean();
  if (t === "DateTime")return new Date();
  if (t === "Json")    return {};
  if (enums[t])        return enumFirst(t);
  try { return new Prisma.Decimal(0); } catch { return 0; }
}
function delegateName(modelName) {
  return modelName[0].toLowerCase() + modelName.slice(1);
}

async function main() {
  console.time("seed-total");

  // Configurable via env if you want to try smaller runs first
  const RESEARCHERS  = parseInt(process.env.SEED_RESEARCHERS || "500", 10);
  const PARTICIPANTS = parseInt(process.env.SEED_PARTICIPANTS || "4000", 10);
  console.log(`[target] researchers=${RESEARCHERS} participants=${PARTICIPANTS}`);

  // Password for ALL users
  const PASSWORD = "pass1234";
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // Core models
  const User  = getModel("User");
  const Study = getModel("Study");

  // Study owner FK (Study -> User)
  const ownerFk = fkFrom(Study, "User");
  if (!ownerFk) throw new Error("Study must relate to User (owner).");
  console.log(`[schema] Study owner FK: ${ownerFk}`);

  // Study version-ish field (optional, used to align consent.version)
  const studyVersionField =
    Study.fields.find(f => f.kind === "scalar" && /^(consent)?version$/i.test(f.name))?.name || null;
  if (studyVersionField) {
    console.log(`[schema] Study version field: ${studyVersionField}`);
  }

  // Enrollment plumbing: Consent is the join we’ll use
  const Consent = getModel("Consent");
  const joinFkToParticipant = relTo(Consent, "Participant") ? fkFrom(Consent, "Participant") : null;
  const joinFkToUser        = relTo(Consent, "User")        ? fkFrom(Consent, "User")        : null;
  const joinFkToStudy       = fkFrom(Consent, "Study");
  if (!joinFkToStudy || (!joinFkToParticipant && !joinFkToUser)) {
    throw new Error("Consent must relate to Study and (Participant or User).");
  }
  const joinRequired = requiredScalars(Consent)
    .filter(f => f.name !== joinFkToStudy && f.name !== joinFkToUser && f.name !== joinFkToParticipant);

  console.log(`[schema] Consent FKs: ${joinFkToParticipant ?? joinFkToUser} → ${joinFkToStudy}`);
  if (joinRequired.length) {
    console.log(`[schema] Consent required scalars: ${joinRequired.map(f => f.name).join(", ")}`);
  }

  // Participant model (optional, but many schemas have it)
  const hasParticipantModel = !!models.Participant;
  let partDelegate = null, partFkToUser = null, partFkToStudy = null, Participant = null, partReq = [];
  if (hasParticipantModel) {
    Participant = getModel("Participant");
    partFkToUser  = fkFrom(Participant, "User");
    partFkToStudy = fkFrom(Participant, "Study");
    if (!partFkToUser || !partFkToStudy) {
      throw new Error("Participant must relate to User and Study.");
    }
    partReq = requiredScalars(Participant)
      .filter(f => f.name !== partFkToUser && f.name !== partFkToStudy);
    partDelegate = delegateName("Participant");
    console.log(`[schema] Participant FKs: ${partFkToUser}, ${partFkToStudy}`);
    if (partReq.length) console.log(`[schema] Participant required scalars: ${partReq.map(f => f.name).join(", ")}`);
  }

  // ---- Create researchers ----
  console.time("users:researchers");
  const researchers = await Promise.all(
    Array.from({ length: RESEARCHERS }, (_, i) =>
      prisma.user.upsert({
        where: { email: `researcher.${i + 1}@seed.local` },
        update: {},
        create: { email: `researcher.${i + 1}@seed.local`, passwordHash, role: "researcher" }
      })
    )
  );
  console.timeEnd("users:researchers");
  console.log(`→ researchers: ${researchers.length}`);

  // ---- Create studies (5–8 per researcher) ----
  console.time("studies");
  const studyRowsToCreate = [];
  for (const r of researchers) {
    const n = faker.number.int({ min: 5, max: 8 });
    for (let j = 0; j < n; j++) {
      const row = {};
      for (const f of requiredScalars(Study)) row[f.name] = randForField(f);
      row[ownerFk] = r.id;
      if (!("slug"  in row)) row.slug  = `${faker.word.sample()}-${faker.string.alphanumeric({ length: 6 }).toLowerCase()}`;
      if (!("title" in row)) row.title = faker.lorem.words({ min: 2, max: 4 });

      const statusField = Study.fields.find(
        f => f.kind === "scalar" && (f.name === "status" || f.name === "visibility")
      );
      if (statusField && !(statusField.name in row)) {
        row[statusField.name] = statusField.type === "String"
          ? faker.helpers.arrayElement(["public", "invite"])
          : enumFirst(statusField.type);
      }

      if (studyVersionField && !(studyVersionField in row)) {
        row[studyVersionField] = 1; // initialize version
      }

      // If there's a required retention-like field without default, put a reasonable value
      const retField = Study.fields.find(
        f => f.kind === "scalar" && f.isRequired && !f.hasDefaultValue && f.type === "Int" && /retention/i.test(f.name)
      );
      if (retField && !(retField.name in row)) row[retField.name] = faker.number.int({ min: 30, max: 120 });

      studyRowsToCreate.push(row);
    }
  }
  for (let i = 0; i < studyRowsToCreate.length; i += 1000) {
    await prisma.study.createMany({ data: studyRowsToCreate.slice(i, i + 1000), skipDuplicates: true });
  }
  const studies = await prisma.study.findMany({ select: { id: true, ...(studyVersionField ? { [studyVersionField]: true } : {}) } });
  console.timeEnd("studies");
  console.log(`→ studies in DB: ${studies.length}`);

  // ---- Create participants (users) ----
  console.time("users:participants");
  const limit = pLimit(64);
  const participantUsers = await Promise.all(
    Array.from({ length: PARTICIPANTS }, (_, i) =>
      limit(() =>
        prisma.user.upsert({
          where: { email: `participant.${i + 1}@seed.local` },
          update: {},
          create: { email: `participant.${i + 1}@seed.local`, passwordHash, role: "participant" }
        })
      )
    )
  );
  console.timeEnd("users:participants");
  console.log(`→ participant users: ${participantUsers.length}`);

  // ---- Build enrollments for each participant user (3–6 random studies) ----
  const studyIds = studies.map(s => s.id);

  // If you have a Participant model, create (user,study) participant rows first
  let participantMap = new Map(); // key `${userId}:${studyId}` -> participantId
  if (hasParticipantModel) {
    console.time("participant-entities");
    const toInsert = [];
    for (const u of participantUsers) {
      const picks = faker.helpers.arrayElements(studyIds, faker.number.int({ min: 3, max: 6 }));
      for (const sid of picks) {
        const row = {};
        for (const f of partReq) row[f.name] = randForField(f);
        row[partFkToUser]  = u.id;
        row[partFkToStudy] = sid;
        toInsert.push(row);
      }
    }
    // Bulk insert
    for (let i = 0; i < toInsert.length; i += 2000) {
      await prisma[partDelegate].createMany({ data: toInsert.slice(i, i + 2000), skipDuplicates: true });
    }
    // Read back minimal mapping
    const parts = await prisma[partDelegate].findMany({ select: { id: true, [partFkToUser]: true, [partFkToStudy]: true } });
    for (const p of parts) {
      participantMap.set(`${p[partFkToUser]}:${p[partFkToStudy]}`, p.id);
    }
    console.timeEnd("participant-entities");
    console.log(`→ participant entities present: ${parts.length}`);
  }

  // ---- Create Consent rows (the enrollment the UI reads) ----
  console.time("consents");
  const consentDelegate = delegateName("Consent");
  const consentToInsert = [];

  for (const u of participantUsers) {
    // Pick a fresh set for consents to guarantee 3–6
    const picks = faker.helpers.arrayElements(studies, faker.number.int({ min: 3, max: 6 }));
    for (const s of picks) {
      const row = {};
      row[joinFkToStudy] = s.id;

      if (joinFkToParticipant) {
        const pid = participantMap.get(`${u.id}:${s.id}`);
        if (!pid) {
          // If schema demands participantId but it doesn't exist, create it now.
          if (hasParticipantModel) {
            const created = await prisma[partDelegate].create({
              data: {
                [partFkToUser]:  u.id,
                [partFkToStudy]: s.id,
                ...Object.fromEntries(partReq.map(f => [f.name, randForField(f)]))
              },
              select: { id: true }
            });
            participantMap.set(`${u.id}:${s.id}`, created.id);
            row[joinFkToParticipant] = created.id;
          } else {
            // Shouldn't happen, but skip if we cannot satisfy schema
            continue;
          }
        } else {
          row[joinFkToParticipant] = pid;
        }
      } else if (joinFkToUser) {
        row[joinFkToUser] = u.id;
      }

      // Required consent scalars
      const base = Object.fromEntries(joinRequired.map(f => [f.name, randForField(f)]));
      // Force granted semantics if these fields exist
      if (Consent.fields.some(f => f.name === "granted")) base["granted"] = true;
      if (Consent.fields.some(f => f.name === "withdrawn")) base["withdrawn"] = false;
      if (Consent.fields.some(f => f.name === "withdrawnAt")) base["withdrawnAt"] = null;
      if (Consent.fields.some(f => f.name === "createdAt")) base["createdAt"] = new Date();

      // Align consent.version to study version if present
      if (Consent.fields.some(f => f.name === "version")) {
        base["version"] = studyVersionField ? (s[studyVersionField] ?? 1) : 1;
      }

      consentToInsert.push({ ...row, ...base });
    }
  }

  for (let i = 0; i < consentToInsert.length; i += 2000) {
    await prisma[consentDelegate].createMany({ data: consentToInsert.slice(i, i + 2000), skipDuplicates: true });
  }
  const consentCount = await prisma[consentDelegate].count();
  console.timeEnd("consents");
  console.log(`→ total Consent rows in DB: ${consentCount}`);

  console.timeEnd("seed-total");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("SEED FAILED:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
