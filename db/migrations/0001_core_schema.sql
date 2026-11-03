-- Core schema. Single user, so profile and style_guide are one-row tables
-- enforced with a check on id = 1. The reasoning behind the shape is in
-- docs/schema.md; this file is the contract.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Profile: who Malin is. Claude proposes the colouring and proportion fields
-- from photos; the row is only trusted once confirmed_at is set.
-- ---------------------------------------------------------------------------
create table profile (
  id                smallint primary key default 1 check (id = 1),
  height_cm         numeric(5, 1) check (height_cm between 100 and 250),

  undertone         text check (undertone in ('warm', 'cool', 'neutral', 'olive')),
  skin_depth        text check (skin_depth in ('fair', 'light', 'medium', 'tan', 'deep')),
  hair_colour       text,
  hair_texture      text,
  eye_colour        text,
  contrast_level    text check (contrast_level in ('low', 'medium', 'high')),
  season            text check (season in (
                      'bright spring', 'true spring', 'light spring',
                      'light summer', 'true summer', 'soft summer',
                      'soft autumn', 'true autumn', 'deep autumn',
                      'deep winter', 'true winter', 'bright winter')),
  season_confidence smallint check (season_confidence between 0 and 100),

  build             text check (build in ('slim', 'athletic', 'broad')),
  shoulder_hip      text check (shoulder_hip in ('shoulders_wider', 'balanced', 'hips_wider')),
  torso_leg         text check (torso_leg in ('long_torso', 'balanced', 'long_legs')),
  neck_length       text check (neck_length in ('short', 'average', 'long')),

  -- Typed-in groups. Shapes are documented in docs/schema.md and validated in
  -- the app, not here, because they will change as the forms do.
  sizes             jsonb not null default '{}'::jsonb,
  fit_preferences   jsonb not null default '{}'::jsonb,
  life              jsonb not null default '{}'::jsonb,
  taste             jsonb not null default '{}'::jsonb,
  budget            jsonb not null default '{}'::jsonb,

  -- The raw Claude analysis the confirmed fields were derived from, kept so a
  -- correction can be compared against what the model saw.
  analysis          jsonb,
  analysed_at       timestamptz,
  confirmed_at      timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger profile_updated_at
  before update on profile
  for each row execute function set_updated_at();

-- Files live on disk (PHOTOS_DIR); the table is the index. deleted_at is the
-- "delete photos, keep the derived profile" action.
create table profile_photos (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('face', 'full_body', 'reference')),
  path        text not null unique,
  mime        text not null,
  bytes       integer not null check (bytes > 0),
  width       integer,
  height      integer,
  sha256      text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Style guide: what suits him. Generated from the profile, then editable.
-- Structured so the finder can read it, not prose.
-- ---------------------------------------------------------------------------
create table style_guide (
  id              smallint primary key default 1 check (id = 1),
  palette         jsonb not null default '{}'::jsonb,
  silhouette      jsonb not null default '{}'::jsonb,
  shoes           jsonb not null default '{}'::jsonb,
  accessories     jsonb not null default '{}'::jsonb,
  fit_vocabulary  jsonb not null default '{}'::jsonb,
  model           text,
  generated_at    timestamptz,
  edited_at       timestamptz
);

-- ---------------------------------------------------------------------------
-- Blueprint: what to own. One row per slot; the finder matches products
-- against these, never against a vague notion of style.
-- ---------------------------------------------------------------------------
create table blueprint_slots (
  id                bigint generated always as identity primary key,
  position          integer not null,
  name              text not null,
  why               text not null,
  priority          smallint not null check (priority between 1 and 3),
  garment_type      text not null,
  colour_family     text,
  colours           text[] not null default '{}',
  fabrics           text[] not null default '{}',
  fit               text,
  sizes             jsonb not null default '{}'::jsonb,
  budget_min_cents  integer check (budget_min_cents >= 0),
  budget_max_cents  integer check (budget_max_cents >= budget_min_cents),
  status            text not null default 'wanted'
                      check (status in ('wanted', 'candidate', 'owned', 'retired')),
  source            text not null check (source in ('claude', 'malin')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index blueprint_slots_status_position on blueprint_slots (status, position);

create trigger blueprint_slots_updated_at
  before update on blueprint_slots
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Retailers and products: what the finder ingests.
-- ---------------------------------------------------------------------------
create table retailers (
  id                bigint generated always as identity primary key,
  slug              text not null unique,
  name              text not null,
  platform          text not null check (platform in ('shopify', 'custom')),
  base_url          text not null,
  country           char(2) not null,
  currency          char(3) not null,
  ships_to_nz       boolean not null default true,
  -- {"name": "...", "address": "...", "verified": false}. Shown as "try on at"
  -- only once verified is true.
  wellington_store  jsonb,
  enabled           boolean not null default true,
  robots_checked_at timestamptz,
  robots_allowed    boolean,
  last_ingested_at  timestamptz,
  created_at        timestamptz not null default now()
);

create table products (
  id            bigint generated always as identity primary key,
  retailer_id   bigint not null references retailers (id),
  external_id   text not null,
  handle        text,
  title         text not null,
  vendor        text,
  product_type  text,
  tags          text[] not null default '{}',
  body_html     text,
  url           text not null,
  -- [{"src": "...", "width": 0, "height": 0, "alt": null}]
  images        jsonb not null default '[]'::jsonb,
  -- Set by the filter stage. Null until classified.
  menswear      boolean,
  -- Hash of the normalised product; a changed hash means re-score.
  content_hash  text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  removed_at    timestamptz,
  unique (retailer_id, external_id)
);

create index products_retailer_seen on products (retailer_id, last_seen_at desc);
create index products_type on products (product_type);

create table product_variants (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references products (id) on delete cascade,
  external_id   text not null,
  title         text,
  option_size   text,
  option_colour text,
  sku           text,
  price_cents   integer not null check (price_cents >= 0),
  compare_at_cents integer check (compare_at_cents >= 0),
  available     boolean not null,
  last_seen_at  timestamptz not null default now(),
  unique (product_id, external_id)
);

create index product_variants_product on product_variants (product_id);

-- One row per change, not per observation, so a stable price costs nothing.
create table price_observations (
  id          bigint generated always as identity primary key,
  variant_id  bigint not null references product_variants (id) on delete cascade,
  observed_at timestamptz not null default now(),
  price_cents integer not null check (price_cents >= 0),
  available   boolean not null
);

create index price_observations_variant on price_observations (variant_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Scores: Claude's verdict on one version of one product.
-- ---------------------------------------------------------------------------
create table product_scores (
  id             bigint generated always as identity primary key,
  product_id     bigint not null references products (id) on delete cascade,
  content_hash   text not null,
  slot_id        bigint references blueprint_slots (id) on delete set null,
  score          smallint not null check (score between 0 and 100),
  colour_verdict text,
  fit_verdict    text,
  fabric_notes   text,
  why            text,
  -- Other slots considered: [{"slot_id": 1, "score": 60}]
  alternatives   jsonb not null default '[]'::jsonb,
  model          text not null,
  input_tokens   integer,
  output_tokens  integer,
  scored_at      timestamptz not null default now(),
  unique (product_id, content_hash)
);

create index product_scores_slot_score on product_scores (slot_id, score desc);

-- ---------------------------------------------------------------------------
-- Feed actions: what Malin did with a recommendation. Append only; the latest
-- row per product wins.
-- ---------------------------------------------------------------------------
create table feed_actions (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products (id) on delete cascade,
  slot_id     bigint references blueprint_slots (id) on delete set null,
  action      text not null check (action in ('saved', 'dismissed', 'bought')),
  reason      text check (reason in ('colour', 'fit', 'price', 'not_for_me', 'other')),
  note        text,
  created_at  timestamptz not null default now()
);

create index feed_actions_product_created on feed_actions (product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Finder runs: one row per nightly job, with its counts and cost.
-- ---------------------------------------------------------------------------
create table finder_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running'
                check (status in ('running', 'succeeded', 'failed')),
  -- {"ingested": 0, "candidates": 0, "scored": 0, "shown": 0, "usd": 0}
  stats       jsonb not null default '{}'::jsonb,
  error       text
);
