-- CreateEnum
CREATE TYPE "public"."StudyStatus" AS ENUM ('draft', 'public', 'invite');

-- AlterTable
ALTER TABLE "public"."Study" ADD COLUMN     "joinCode" TEXT,
ADD COLUMN     "status" "public"."StudyStatus" NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "public"."Enrollment" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Enrollment_participantId_idx" ON "public"."Enrollment"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studyId_participantId_key" ON "public"."Enrollment"("studyId", "participantId");

-- AddForeignKey
ALTER TABLE "public"."Enrollment" ADD CONSTRAINT "Enrollment_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Enrollment" ADD CONSTRAINT "Enrollment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
