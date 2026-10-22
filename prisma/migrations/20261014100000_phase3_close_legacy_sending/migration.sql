-- Data-only migration (no schema change).
--
-- Before async sending (Phase 3.2) a campaign was sent inside the HTTP request. If the process died
-- mid-send, the row was left with status = 'sending' and no startedAt. The background workers now
-- pick up EVERY campaign in 'sending', prepare its recipients and email them, so such a leftover
-- row would suddenly start sending days or weeks later. Close those rows instead.
--
-- Campaigns started by the async flow always have startedAt set (see startSending), so
-- "sending AND startedAt IS NULL" identifies exactly the legacy rows. Unsent legacy campaigns can
-- be re-sent deliberately: use POST /campaigns/:id/retry-failed or create a new campaign.
UPDATE "campaigns"
SET "status" = 'failed',
    "haltReason" = 'legacy_interrupted_before_async_sending',
    "finishedAt" = timezone('UTC', now())
WHERE "status" = 'sending'
  AND "startedAt" IS NULL;
