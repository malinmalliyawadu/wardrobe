-- A try-on of pieces he chose himself: any mix of his wardrobe pieces and the
-- finds he saved, put on him in one image from the On me page. Asked for by
-- Malin on 2026-11-04, under the photo rule in docs/plan.md 1.1 as it stood
-- for a look: his own photo of a piece, or the shop's photo, goes to OpenAI
-- only when he taps, one image at a time.
--
-- Such a try-on is of neither one find nor one look, so its subject is the
-- pieces as sent alone. Each entry in `pieces` names a wardrobe piece
-- (piece_id) or a saved find (product_id).

alter table try_ons drop constraint try_ons_one_subject;

alter table try_ons add constraint try_ons_one_subject check (
  (product_id is not null and product_image is not null and look_id is null and pieces is null)
  or (product_id is null and product_image is null and look_id is not null and pieces is not null)
  or (product_id is null and product_image is null and look_id is null and pieces is not null)
);

-- The On me page lists every image newest first.
create index try_ons_kept on try_ons (started_at desc) where deleted_at is null;
