-- The photo a product shows, when Malin chose one (asked for 2026-11-07). A
-- shop's first photo is not always the one to judge by or to try on: some
-- lead with a model, a detail or the back. When he pastes a link he can pick
-- another of the shop's photos, or add his own (a find photo, stored like
-- those of finds added by hand, src/lib/find-photos.ts).
--
-- The nightly walk rewrites images and never touches this, so the choice
-- holds. Null follows the shop's first photo.
alter table products add column chosen_image jsonb;

-- What every page shows: his choice, else the shop's first. The finder's own
-- reads (the photo colour rule, Claude's look when scoring) keep images -> 0,
-- the shop's photo, which is what the listing is about and what a URL reaches.
alter table products
  add column main_image jsonb generated always as (coalesce(chosen_image, images -> 0)) stored;
