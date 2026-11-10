-- An outfit from anything, asked for by Malin on 2026-11-10: a fourth thing
-- an outfit from scratch can be made from. Tied to no shop and to nothing he
-- owns, Opus describes the ideal garments in words: what each is, its colour
-- from his palette, its cloth and cut, and the words to search the shops with.

alter table outfits drop constraint outfits_source_check;
alter table outfits add constraint outfits_source_check check (source in ('wardrobe', 'shops', 'both', 'anywhere'));

-- A garment described rather than owned or sold: name, garment_type,
-- colour_name, colour_hex, fabric, fit, why and search.
alter table outfit_items add column idea jsonb;

alter table outfit_items drop constraint outfit_items_check;
alter table outfit_items add constraint outfit_items_one_thing check (num_nonnulls(piece_id, product_id, idea) = 1);
