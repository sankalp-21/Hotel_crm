-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('corporate', 'travel_agency', 'event_planner', 'other');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('lead', 'customer', 'inactive');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "preferences" JSONB,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "status" "ContactStatus" NOT NULL DEFAULT 'lead',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CompanyType" NOT NULL DEFAULT 'other',
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_propertyId_name_idx" ON "companies"("propertyId", "name");

-- CreateIndex
CREATE INDEX "contacts_propertyId_status_idx" ON "contacts"("propertyId", "status");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
