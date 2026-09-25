-- Real data: the pilot's rank, and letters and runs that are only mocks.
--
-- rank is the business's place in its run's shortlist (1 = first letter),
-- null when it did not make the forty. A mock letter was rendered to test
-- the engine on a new area and is never to be sent; a mock run is a run
-- made only of those.

BEGIN;

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS rank int;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS mock boolean NOT NULL DEFAULT false;

ALTER TABLE letters DROP CONSTRAINT IF EXISTS letters_state_check;
ALTER TABLE letters ADD CONSTRAINT letters_state_check CHECK (state IN ('draft','sent','mock'));

INSERT INTO schema_migrations(version) VALUES ('002_real_data') ON CONFLICT DO NOTHING;

COMMIT;
