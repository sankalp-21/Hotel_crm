-- Idempotency keys become private to (user, property) and expire.
-- The table is an ephemeral replay cache; rows written before this migration have no
-- owner scope and could not be attributed safely, so they are discarded.
DELETE FROM "idempotency_keys";

-- DropIndex
DROP INDEX "idempotency_keys_key_key";

-- AlterTable
ALTER TABLE "idempotency_keys" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "scope" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");
