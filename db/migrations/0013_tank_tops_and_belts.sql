-- Two garment types of their own, asked for by Malin on 2026-11-05 when he
-- had nowhere to put pieces he owns:
--
-- Tank tops and singlets ('tank'). Until now the finder threw them out as
-- never a slot; it now reads them as tanks.
--
-- Belts ('belt'). They were accessories of kind 'belt', which the piece form
-- could not say. Slots, products and pieces that are belts move across, so the
-- finder keeps matching a belt slot with belt products before the next ingest
-- reclassifies the catalogue.

alter table blueprint_slots drop constraint blueprint_slots_garment_type_check;
alter table blueprint_slots add constraint blueprint_slots_garment_type_check check (garment_type in (
  'tee', 'tank', 'polo', 'shirt', 'overshirt', 'knitwear', 'sweatshirt',
  'trousers', 'jeans', 'shorts', 'tailoring', 'jacket', 'coat',
  'activewear', 'shoes', 'boots', 'sneakers', 'belt', 'accessory', 'bag'));

alter table products drop constraint products_garment_type_check;
alter table products add constraint products_garment_type_check check (garment_type in (
  'tee', 'tank', 'polo', 'shirt', 'overshirt', 'knitwear', 'sweatshirt',
  'trousers', 'jeans', 'shorts', 'tailoring', 'jacket', 'coat',
  'activewear', 'shoes', 'boots', 'sneakers', 'belt', 'accessory', 'bag'));

alter table wardrobe_pieces drop constraint wardrobe_pieces_garment_type_check;
alter table wardrobe_pieces add constraint wardrobe_pieces_garment_type_check check (garment_type in (
  'tee', 'tank', 'polo', 'shirt', 'overshirt', 'knitwear', 'sweatshirt',
  'trousers', 'jeans', 'shorts', 'tailoring', 'jacket', 'coat',
  'activewear', 'shoes', 'boots', 'sneakers', 'belt', 'accessory', 'bag'));

update products set garment_type = 'belt', garment_kind = null
where garment_type = 'accessory' and garment_kind = 'belt';

update blueprint_slots set garment_type = 'belt'
where garment_type = 'accessory' and name ~* '\mbelts?\M';

update wardrobe_pieces set garment_type = 'belt'
where garment_type = 'accessory' and name ~* '\mbelts?\M';
