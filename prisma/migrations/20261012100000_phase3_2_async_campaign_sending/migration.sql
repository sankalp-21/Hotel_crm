-- AlterEnum
ALTER TYPE "CampaignStatus" ADD VALUE 'cancelled';

-- AlterEnum
ALTER TYPE "CampaignRecipientStatus" ADD VALUE 'sending';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "haltReason" TEXT,
ADD COLUMN     "lastProgressAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "prepareCursor" TEXT,
ADD COLUMN     "preparedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "campaignSendRatePerSec" INTEGER;

-- CreateIndex
CREATE INDEX "campaigns_status_leaseUntil_idx" ON "campaigns"("status", "leaseUntil");
