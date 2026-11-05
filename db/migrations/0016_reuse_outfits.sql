-- One outfit, one look, and its pictures made once. Asked for by Malin on
-- 2026-11-05: wherever an outfit already made comes round again, it is the
-- look already there, with its flat lay and its pictures of him, never a new
-- one to pay for.

-- The looks a set offered, in order. A set of looks may offer a look an
-- earlier set or day already made, so a look's own set_id is now only the set
-- that first made it, and what the Looks tab shows as the newest set is read
-- from here.
create table look_set_looks (
  set_id   bigint not null references look_sets (id) on delete cascade,
  position smallint not null,
  look_id  bigint not null references looks (id) on delete cascade,
  primary key (set_id, position)
);

create index look_set_looks_look on look_set_looks (look_id);

insert into look_set_looks (set_id, position, look_id)
select set_id, position, id from looks;

-- What a picture is of, as a key that does not care about order: "p12" for a
-- wardrobe piece, "f34" for a find, sorted byte-wise and joined with commas
-- (outfitKey in src/lib/outfit-key.ts). A try-on of a find is "f34"; one of a
-- look or of pieces he chose is its pieces. Two pictures with the same key
-- are of the same outfit, whichever look or tap asked for them.
alter table try_ons add column outfit_key text;

update try_ons set outfit_key = 'f' || product_id where product_id is not null;

update try_ons t set outfit_key = coalesce((
  select string_agg(k, ',' order by k collate "C")
  from (
    select case when e ->> 'piece_id' is not null then 'p' || (e ->> 'piece_id') else 'f' || (e ->> 'product_id') end as k
    from jsonb_array_elements(t.pieces) e
  ) keys
), '')
where product_id is null;

alter table try_ons alter column outfit_key set not null;

create index try_ons_outfit on try_ons (outfit_key, started_at desc) where deleted_at is null;

-- A flat lay is of a look's pieces, all from the wardrobe.
alter table look_images add column outfit_key text;

update look_images i set outfit_key = coalesce((
  select string_agg(k, ',' order by k collate "C")
  from (select 'p' || (e ->> 'piece_id') as k from jsonb_array_elements(i.pieces) e) keys
), '');

alter table look_images alter column outfit_key set not null;

create index look_images_outfit on look_images (outfit_key, started_at desc);
