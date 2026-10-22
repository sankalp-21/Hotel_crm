-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('manual', 'unsubscribed', 'bounced', 'complaint');

-- AlterTable
-- Existing contacts get marketingConsent = false: they are NOT emailed until consent is recorded.
ALTER TABLE "contacts" ADD COLUMN     "consentSource" TEXT,
ADD COLUMN     "consentUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "emailBounced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unsubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL DEFAULT 'manual',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppression_entries_propertyId_createdAt_idx" ON "suppression_entries"("propertyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entries_propertyId_channel_address_key" ON "suppression_entries"("propertyId", "channel", "address");

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
