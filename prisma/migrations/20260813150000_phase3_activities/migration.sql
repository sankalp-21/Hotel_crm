-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('call', 'email', 'meeting', 'task', 'note');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('open', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "type" "ActivityType" NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'open',
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "dueAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_propertyId_status_idx" ON "activities"("propertyId", "status");

-- CreateIndex
CREATE INDEX "activities_propertyId_dueAt_idx" ON "activities"("propertyId", "dueAt");

-- CreateIndex
CREATE INDEX "activities_contactId_createdAt_idx" ON "activities"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_dealId_idx" ON "activities"("dealId");

-- CreateIndex
CREATE INDEX "activities_reminderAt_reminderSentAt_status_idx" ON "activities"("reminderAt", "reminderSentAt", "status");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
