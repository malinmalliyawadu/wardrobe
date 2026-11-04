-- Stores whose site cannot be read at all: Lululemon NZ answers every request
-- but robots.txt with a Cloudflare challenge, and it is not Shopify. Asked for
-- by Malin on 2026-11-05. A 'manual' store is never walked and never read; a
-- find from it is typed in by him on Saved, with a photo he chooses, and
-- stored as a product like any other, so slots, try-ons and "Bought it" work
-- unchanged. Its price is what he typed and is never checked.

alter table retailers drop constraint retailers_platform_check;

alter table retailers add constraint retailers_platform_check
  check (platform in ('shopify', 'uniqlo', 'manual'));

-- The photo of a find he added by hand: usually the shop's own product photo,
-- saved from its page. Stored like his photos (a metadata-free master and a
-- thumb under PHOTOS_DIR/finds), never bytea, served only through
-- /photos/finds/:id. A row exists before its product does, because the photo
-- is stored as soon as he chooses it, so one no product uses is cleared after
-- a day.
create table find_photos (
  id         bigint generated always as identity primary key,
  -- Relative to PHOTOS_DIR. The thumb sits next to it as .thumb.jpg.
  path       text not null unique,
  bytes      integer not null check (bytes > 0),
  width      integer not null,
  height     integer not null,
  sha256     text not null,
  created_at timestamptz not null default now()
);

-- Which of those photos a product shows. Its images list carries the same
-- photo as /photos/finds/:id, so a product's photo is read from one place
-- whatever the store; this column is what keeps the photo from being cleared.
alter table products
  add column find_photo_id bigint references find_photos (id) on delete set null;

create index products_find_photo on products (find_photo_id) where find_photo_id is not null;
