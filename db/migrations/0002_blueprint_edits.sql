-- M2: what the blueprint needs beyond the first cut.
--
-- edited_at marks a slot Malin has changed by hand, so a redraft keeps it
-- instead of replacing it. replaces_id links a refill to the retired slot it
-- took over from, so the retired slot stops offering a refill. Garment type
-- and fit get the closed vocabularies from src/lib/wardrobe-values.ts and
-- src/lib/profile-values.ts, because the finder filters on both.

alter table blueprint_slots
  add column edited_at   timestamptz,
  add column replaces_id bigint references blueprint_slots (id) on delete set null;

alter table blueprint_slots
  add constraint blueprint_slots_garment_type_check check (garment_type in (
    'tee', 'polo', 'shirt', 'overshirt', 'knitwear', 'sweatshirt',
    'trousers', 'jeans', 'shorts', 'tailoring', 'jacket', 'coat',
    'activewear', 'shoes', 'boots', 'sneakers', 'accessory', 'bag')),
  add constraint blueprint_slots_fit_check check (
    fit is null or fit in ('slim', 'regular', 'relaxed', 'oversized'));

create index blueprint_slots_priority_position on blueprint_slots (priority, position);
create unique index blueprint_slots_replaces on blueprint_slots (replaces_id) where replaces_id is not null;
