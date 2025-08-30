-- CreateTable
CREATE TABLE "public"."Upload" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Upload_studyId_participantId_categoryId_createdAt_idx" ON "public"."Upload"("studyId", "participantId", "categoryId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."DataCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
