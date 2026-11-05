-- Looks around a piece, asked for by Malin on 2026-11-05: on a piece's page,
-- a tap makes a few looks that each wear that piece, from the rest of what he
-- owns. They are a set of their own kind, so the Looks tab's newest set stays
-- the newest he made there; what he saves from one joins his saved looks.

alter table look_sets drop constraint look_sets_kind_check;
alter table look_sets add constraint look_sets_kind_check check (kind in ('set', 'day', 'piece'));

-- The piece a set of kind 'piece' was made around. A deleted piece leaves the
-- set and its looks on record, as it does for any look it was in.
alter table look_sets add column piece_id bigint references wardrobe_pieces (id) on delete set null;

create index look_sets_piece on look_sets (piece_id, created_at desc) where piece_id is not null;
