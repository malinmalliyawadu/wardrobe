-- Statement pieces, asked for by Malin on 2026-11-05: a way to find the pieces
-- that carry an outfit by their colour, their texture or their cut, which the
-- slots of the blueprint (mostly the right basics) never look for.
--
-- Every night, after the slots are judged, free rules pick likely statement
-- pieces from everything read (one of his bold best colours, a texture, or a
-- cut or detail the listing names, in his size and inside his budget), and
-- Sonnet judges each one once per version, within a nightly cap of its own.
-- The Statements page shows the latest run's shortlist that cleared the bar.

-- What judging statements may spend a night, in US dollars like the other
-- caps; it counts toward the monthly cap with the rest of the run.
alter table finder_settings
  add column max_usd_statements numeric(8, 2) not null default 0.50 check (max_usd_statements >= 0);

-- What the rules let through in each run, priced and sized like
-- finder_candidates, with what made the rules pick it.
create table statement_candidates (
  run_id           bigint not null references finder_runs (id) on delete cascade,
  product_id       bigint not null references products (id) on delete cascade,
  content_hash     text not null,
  -- 'colour', 'texture', 'cut': the signals the listing gave the rules.
  signals          text[] not null check (signals <@ array['colour', 'texture', 'cut'] and cardinality(signals) > 0),
  sizes            text[] not null default '{}',
  size_known       boolean not null,
  price_cents      integer not null check (price_cents >= 0),
  compare_at_cents integer check (compare_at_cents >= 0),
  primary key (run_id, product_id)
);

create index statement_candidates_product on statement_candidates (product_id);

-- Claude's verdict on a product as a statement piece for him, once per
-- version of the listing, like product_scores.
create table statement_scores (
  id                 bigint generated always as identity primary key,
  product_id         bigint not null references products (id) on delete cascade,
  content_hash       text not null,
  -- How good a statement piece it is for him: it stands out, it suits him,
  -- and it wears with what he owns.
  score              smallint not null check (score between 0 and 100),
  -- What makes it one, in Claude's judgement: 'colour', 'texture', 'cut'.
  qualities          text[] not null default '{}' check (qualities <@ array['colour', 'texture', 'cut']),
  colour_option      text,
  why                text not null,
  -- Wardrobe pieces it wears with, as they were when it was judged. No
  -- foreign key on an array: a piece deleted since is dropped when read.
  wears_with         bigint[] not null default '{}',
  model              text not null,
  served_by          text,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  usd                numeric(10, 6),
  run_id             bigint references finder_runs (id) on delete set null,
  scored_at          timestamptz not null default now(),
  unique (product_id, content_hash)
);

create index statement_scores_run on statement_scores (run_id);
