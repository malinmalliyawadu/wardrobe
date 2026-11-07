-- A find's cut in words, for the try-on (asked for by Malin 2026-11-07). An
-- image editor told only to let a garment "fit the way that cut would" fits
-- it to his body: an oversized overshirt, shot a size up on a slim model,
-- came back a regular fit. So before a try-on with a find is made, Sonnet
-- reads the shop's photo and listing once and says where the seams sit, how
-- much room there is and where it ends, and the prompt carries that
-- (src/lib/garment-cut.ts).
--
-- One read per product and photo: a different photo chosen is a new read.
-- Only a shop's photo is read; his own photo of a find goes nowhere but the
-- try-on editor.
create table product_cuts (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references products(id) on delete cascade,
  image_src     text not null,
  fit           text check (fit is null or fit in ('slim', 'regular', 'relaxed', 'oversized')),
  silhouette    text not null,
  model         text not null,
  served_by     text,
  input_tokens  integer,
  output_tokens integer,
  usd           numeric(10,6),
  read_at       timestamptz not null default now(),
  unique (product_id, image_src)
);
