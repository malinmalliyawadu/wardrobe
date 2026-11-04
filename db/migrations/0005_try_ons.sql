-- M3.5: try-on. "See it on me" on a feed find sends one of Malin's
-- full-length photos and the product's own image to an image model, which
-- returns him wearing it. One row per image asked for, made on request only.
--
-- The image is a file on the photos volume (PHOTOS_DIR/try-ons), like his
-- photos, never bytea. "Delete photos" removes the files and stamps
-- deleted_at; the row stays, without the file, so spend stays countable.

create table try_ons (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references products (id) on delete cascade,
  -- The full-length photo he was dressed from.
  photo_id      bigint not null references profile_photos (id),
  -- The product photo sent, as listed, so a new listing photo is a new try-on.
  product_image text not null,
  provider      text not null check (provider in ('openai')),
  model         text not null,
  status        text not null default 'making' check (status in ('making', 'ready', 'failed')),
  -- Relative to PHOTOS_DIR; null until it is ready, and again once deleted.
  path          text unique,
  width         integer,
  height        integer,
  -- What was asked for, to compare prompts and settings across images.
  prompt        text not null,
  settings      jsonb not null default '{}'::jsonb,
  -- The provider's own id for the request, which is what a deletion or
  -- support request to them needs.
  request_id    text,
  input_tokens  integer,
  output_tokens integer,
  usage         jsonb,
  usd           numeric(10, 6),
  -- Shown on the card when it failed, in words for him.
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  deleted_at    timestamptz
);

-- On request only, never in bulk: one image in the making at a time, held by
-- the database rather than by the page.
create unique index try_ons_one_making on try_ons ((true)) where status = 'making';

create index try_ons_product on try_ons (product_id, started_at desc);
create index try_ons_photo on try_ons (photo_id) where deleted_at is null;
