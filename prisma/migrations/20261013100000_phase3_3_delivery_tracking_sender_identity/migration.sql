-- AlterEnum
ALTER TYPE "CampaignRecipientStatus" ADD VALUE 'bounced';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "bouncedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "complainedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "bouncedAt" TIMESTAMP(3),
ADD COLUMN     "complainedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "providerMessageId" TEXT;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "emailFromAddress" TEXT,
ADD COLUMN     "emailFromName" TEXT,
ADD COLUMN     "emailReplyTo" TEXT;

-- CreateIndex
CREATE INDEX "campaign_recipients_providerMessageId_idx" ON "campaign_recipients"("providerMessageId");
