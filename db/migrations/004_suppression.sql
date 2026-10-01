-- The do-not-contact list (lib/suppression.js).
--
-- Kept apart from prospects, so it survives every re-import and re-render
-- and reaches businesses found again in a later run or another area: any
-- prospect whose phone or mailing address matches a live entry is do not
-- contact. An entry outlives the prospect it came from (ON DELETE SET
-- NULL), so a deletion request still stops us writing again.
--
-- reason:     stop_text (they texted an opt-out word), by_hand (marked in
--             Explorer or from the command line), deletion_request.
-- source_ref: what made it, where that is unique: the Twilio message sid of
--             a STOP text, so recording the same text twice adds nothing.
-- revoked_at: only a by_hand entry is ever taken back, and only with an
--             explicit confirm. The row stays as the record.

CREATE TABLE IF NOT EXISTS suppressions (
  id           bigserial PRIMARY KEY,
  phone_key    text,
  address_key  text,
  reason       text NOT NULL CHECK (reason IN ('stop_text','by_hand','deletion_request')),
  source_ref   text UNIQUE,
  prospect_id  text REFERENCES prospects(id) ON DELETE SET NULL,
  detail       jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  CHECK (phone_key IS NOT NULL OR address_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS suppressions_phone ON suppressions(phone_key) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS suppressions_address ON suppressions(address_key) WHERE revoked_at IS NULL;

-- The same keys on every prospect, written by the importers and by
-- db/suppression.js --backfill, so matching is plain equality.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS phone_key text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS address_key text;
CREATE INDEX IF NOT EXISTS prospects_phone_key ON prospects(phone_key);
CREATE INDEX IF NOT EXISTS prospects_address_key ON prospects(address_key);
