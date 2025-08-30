-- CreateTable
CREATE TABLE "public"."Consent" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "receiptHash" TEXT NOT NULL,
    "receiptJson" JSONB NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConsentChoice" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "ConsentChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "prevHash" TEXT,
    "entryHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consent_studyId_participantId_version_idx" ON "public"."Consent"("studyId", "participantId", "version");

-- CreateIndex
CREATE INDEX "ConsentChoice_consentId_idx" ON "public"."ConsentChoice"("consentId");

-- CreateIndex
CREATE INDEX "ConsentChoice_categoryId_idx" ON "public"."ConsentChoice"("categoryId");

-- CreateIndex
CREATE INDEX "AuditLog_studyId_createdAt_idx" ON "public"."AuditLog"("studyId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Consent" ADD CONSTRAINT "Consent_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Consent" ADD CONSTRAINT "Consent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConsentChoice" ADD CONSTRAINT "ConsentChoice_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "public"."Consent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConsentChoice" ADD CONSTRAINT "ConsentChoice_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."DataCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;
