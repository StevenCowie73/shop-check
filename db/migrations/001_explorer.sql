-- Explorer: the ColdenJames prospect database.
--
-- Everything here is either public record (the state licence register),
-- something we did (a letter, a text), or something we observed about a
-- website ourselves. Nothing from Google is stored except place_id, which
-- Google's terms allow keeping indefinitely: ratings, reviews, hours and
-- photos are fetched live when a page is opened and never written here.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/001_explorer.sql

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- An area a pipeline run covers: a set of parishes, optionally narrowed to
-- towns and zips (finder/pilot/lib/area.js).
CREATE TABLE IF NOT EXISTS areas (
  id          text PRIMARY KEY,                 -- 'bossier-caddo', 'youngsville'
  name        text NOT NULL,                    -- 'Bossier / Caddo'
  parishes    jsonb NOT NULL DEFAULT '{}',      -- {"2098":"Caddo","1815":"Bossier"}
  towns       text[] NOT NULL DEFAULT '{}',
  zips        text[] NOT NULL DEFAULT '{}',
  here_in     text NOT NULL DEFAULT 'Louisiana' -- the letter's location line
);

-- One pass of the pipeline over an area.
CREATE TABLE IF NOT EXISTS runs (
  id          text PRIMARY KEY,
  area_id     text NOT NULL REFERENCES areas(id),
  label       text NOT NULL,                    -- 'Youngsville test'
  started_at  timestamptz NOT NULL,
  funnel      jsonb NOT NULL DEFAULT '{}',      -- {"licences":641,"inArea":76,"active":43,"picked":20}
  cost_usd    numeric(8,2) NOT NULL DEFAULT 0,
  problems    text[] NOT NULL DEFAULT '{}'
);

-- A business, as the licence register describes it. The register is public
-- record; everything in this row came from it or from us.
CREATE TABLE IF NOT EXISTS prospects (
  id                 text PRIMARY KEY,          -- the reference code (lib/refs.js)
  area_id            text NOT NULL REFERENCES areas(id),
  run_id             text REFERENCES runs(id),  -- the run that picked it, if any
  company            text NOT NULL,
  owner_name         text,                      -- the qualifying party
  trade              text,                      -- 'fence company', from the name
  licence_types      text[] NOT NULL DEFAULT '{}',
  licence_status     text,                      -- 'Active'
  first_issued       date,
  email              text,
  phone              text,
  mailing_street     text,
  mailing_city       text,
  mailing_state      text,
  mailing_zip        text,
  lat                double precision,          -- the licence mailing address, geocoded
  lng                double precision,
  geocode_source     text,                      -- 'census' | 'demo' | null
  place_id           text,                      -- Google's id: the only Google value kept
  status             text NOT NULL DEFAULT 'not_contacted'
                     CHECK (status IN ('not_contacted','letter_sent','page_opened','replied','client','closed')),
  selected           boolean NOT NULL DEFAULT false,
  do_not_contact     boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospects_area ON prospects(area_id);
CREATE INDEX IF NOT EXISTS prospects_status ON prospects(status);

-- What our own website check saw (finder/lib/site-audit.js). One row per
-- check; the newest is the current one.
CREATE TABLE IF NOT EXISTS audits (
  id            bigserial PRIMARY KEY,
  prospect_id   text NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  url           text,
  state         text NOT NULL
                CHECK (state IN ('fine','poor','broken','not_found','unknown','blocked')),
  loads         boolean,                        -- null: never looked at
  https         boolean,
  viewport      boolean,
  phone_on_page boolean,
  newest_year   int,
  status_code   int,
  whats_wrong   text,
  found_by      text,                           -- 'email' | 'astra'
  checked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audits_prospect ON audits(prospect_id, checked_at DESC);

-- A letter, drafted or sent. The HTML is kept as rendered, so "as sent"
-- means exactly that.
CREATE TABLE IF NOT EXISTS letters (
  id           bigserial PRIMARY KEY,
  prospect_id  text NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  run_id       text REFERENCES runs(id),
  state        text NOT NULL CHECK (state IN ('draft','sent')),
  html         text NOT NULL,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Everything that happened, in one timeline: selected, letter sent, page
-- opened, call, text, reply, outcome, run. prospect_id is null for events
-- about no one business (a run finishing, a call from an unknown number).
CREATE TABLE IF NOT EXISTS events (
  id           bigserial PRIMARY KEY,
  prospect_id  text REFERENCES prospects(id) ON DELETE CASCADE,
  run_id       text REFERENCES runs(id),
  kind         text NOT NULL,                   -- 'selected','letter_sent','page_opened','call_in','text_in','text_out','reply','outcome','run'
  at           timestamptz NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}',     -- channel, device, call status ... never Google data
  source       text                             -- 'pilot','tracking','twilio','manual'
);
CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);
CREATE INDEX IF NOT EXISTS events_prospect ON events(prospect_id, at DESC);

-- Texts and calls on the ColdenJames number, as Twilio logged them.
CREATE TABLE IF NOT EXISTS messages (
  id           text PRIMARY KEY,                -- Twilio's SM.../CA... sid
  prospect_id  text REFERENCES prospects(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('call','text')),
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  other_party  text NOT NULL,                   -- E.164; shown masked unless a known prospect
  body         text,
  status       text,
  at           timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_at ON messages(at DESC);

-- Steven's own notes, dated.
CREATE TABLE IF NOT EXISTS notes (
  id           bigserial PRIMARY KEY,
  prospect_id  text NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Hand corrections to anything the pipeline decided (a website, a name).
CREATE TABLE IF NOT EXISTS overrides (
  prospect_id  text NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  field        text NOT NULL,
  value        jsonb,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prospect_id, field)
);

-- How it ended: client, not interested, closed.
CREATE TABLE IF NOT EXISTS outcomes (
  prospect_id  text PRIMARY KEY REFERENCES prospects(id) ON DELETE CASCADE,
  outcome      text NOT NULL CHECK (outcome IN ('client','not_interested','closed','no_response')),
  detail       text,
  decided_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES ('001_explorer') ON CONFLICT DO NOTHING;

COMMIT;
