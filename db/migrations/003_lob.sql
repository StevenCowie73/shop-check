-- Sending letters through Lob.
--
-- A letter is sent only once a person has approved it (state 'approved',
-- approved_at set). A Lob test send records its id here too, with
-- lob_mode 'test', and leaves the letter approved: nothing was printed. A
-- live send records lob_mode 'live' and moves the letter to 'sent'.

BEGIN;

ALTER TABLE letters DROP CONSTRAINT IF EXISTS letters_state_check;
ALTER TABLE letters ADD CONSTRAINT letters_state_check CHECK (state IN ('draft','approved','sent','mock'));

ALTER TABLE letters ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE letters ADD COLUMN IF NOT EXISTS lob_letter_id text;
ALTER TABLE letters ADD COLUMN IF NOT EXISTS lob_mode text CHECK (lob_mode IN ('test','live'));
ALTER TABLE letters ADD COLUMN IF NOT EXISTS expected_delivery_date date;
ALTER TABLE letters ADD COLUMN IF NOT EXISTS lob_sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS letters_lob_letter_id ON letters(lob_letter_id) WHERE lob_letter_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('003_lob') ON CONFLICT DO NOTHING;

COMMIT;
