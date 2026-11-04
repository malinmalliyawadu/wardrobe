-- M5 Reach: on-demand searches. Malin types what he wants ("a navy overshirt
-- under $300") on the Search tab; Sonnet reads the request into the same
-- target a blueprint slot gives the filter, the filter runs over what the
-- nightly run last read, Sonnet scores the closest matches within the
-- search's spend, and what it shows is re-read from the shop for a current
-- price and stock. No blueprint slot is made: the search holds its own target.

-- What one search may spend on Claude, in US dollars like the other caps. It
-- counts toward the monthly cap with the nightly runs.
alter table finder_settings
  add column max_usd_per_search numeric(8, 2) not null default 0.50 check (max_usd_per_search >= 0);

create table searches (
  id          bigint generated always as identity primary key,
  -- What he typed, as he typed it.
  request     text not null check (char_length(request) between 2 and 200),
  status      text not null default 'reading'
              check (status in ('reading', 'filtering', 'scoring', 'checking', 'done', 'failed')),
  -- The request read into the filter's terms (garment, colours, price, fit,
  -- words to rank by); null until it is read.
  target      jsonb,
  -- The heading the page shows, from the read: "A navy overshirt under $300".
  summary     text,
  -- What it was allowed to spend, after the monthly cap.
  max_usd     numeric(8, 4) not null check (max_usd >= 0),
  -- Everything it spent: the read and the scores.
  usd         numeric(10, 6) not null default 0,
  -- Counts and the exchange rates it priced with.
  stats       jsonb not null default '{}'::jsonb,
  -- In words for him, when it failed or could not be read.
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- One search at a time, held by the database like the one try-on in the making.
create unique index searches_one_running on searches ((true))
  where status in ('reading', 'filtering', 'scoring', 'checking');

create index searches_started on searches (started_at desc);

-- The products a search offered to Claude, in the order offered (closest to
-- his words first), each with its verdict once scored. Scores live here, not
-- in product_scores: they answer his request, not a slot.
create table search_results (
  search_id          bigint not null references searches (id) on delete cascade,
  product_id         bigint not null references products (id) on delete cascade,
  content_hash       text not null,
  rank               integer not null,
  sizes              text[] not null default '{}',
  size_known         boolean not null,
  price_cents        integer not null,
  compare_at_cents   integer,
  -- False once a re-read finds it gone or sold out in his size.
  in_stock           boolean not null default true,
  score              smallint check (score between 0 and 100),
  colour_option      text,
  colour_verdict     text,
  fit_verdict        text,
  fabric_notes       text,
  why                text,
  model              text,
  served_by          text,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  usd                numeric(10, 6),
  scored_at          timestamptz,
  -- When the shop was re-read for it, after scoring.
  checked_at         timestamptz,
  primary key (search_id, product_id)
);

create index search_results_product on search_results (product_id);
