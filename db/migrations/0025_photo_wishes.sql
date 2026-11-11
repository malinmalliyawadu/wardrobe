-- A wish from a photo, asked for by Malin on 2026-11-12: something he saw (a
-- screenshot, a photo in a shop, someone on the street) goes on the wishlist
-- with no link. Sonnet reads the photo once to fill in the form he checks, as
-- it does for a piece of his. It is stored as a product, like a find added by
-- hand, so slots, try-ons and "Bought it" work unchanged.

-- The one store such products belong to. Never walked, never read, never in
-- data/retailers.json, and left out of listRetailers, so it is never offered
-- as a shop; switched off so no feed, search, statement or outfit from the
-- shops ever picks one up. It has no site, so no base_url.
alter table retailers drop constraint retailers_platform_check;

alter table retailers add constraint retailers_platform_check
  check (platform in ('shopify', 'uniqlo', 'manual', 'rodd-and-gunn', 'photo'));

insert into retailers (slug, name, platform, base_url, country, currency, ships_to_nz, enabled, catalogue)
values ('photo', 'From a photo', 'photo', '', 'NZ', 'NZD', true, false, 'menswear');

-- A product from a photo has no page to open: its url is the photo's own
-- address, /photos/finds/:id, so a tap on the row shows what he saw.

-- Claude's read of a photo for a wish, and what it cost, like a piece
-- photo's. Null for the photos of finds added by hand, which are not read.
alter table find_photos
  add column read     jsonb,
  add column read_usd numeric(10, 6);
