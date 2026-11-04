-- A try-on of a whole look: him dressed in one of his looks, made by OpenAI
-- from his full-length photo and the photos of the look's pieces. Agreed with
-- Malin on 2026-11-04, extending the photo rule in docs/plan.md 1.1: a photo
-- of one of his pieces now goes to OpenAI too, only for a look try-on he asks
-- for. A try-on is now of a find or of a look, never both.

alter table try_ons alter column product_id drop not null;
alter table try_ons alter column product_image drop not null;

alter table try_ons add column look_id bigint references looks (id) on delete cascade;

-- The look's pieces as sent, in order, and how each was shown: his own photo
-- of it, the shop's photo, or only in words when it has neither.
alter table try_ons add column pieces jsonb;

alter table try_ons add constraint try_ons_one_subject check (
  (product_id is not null and product_image is not null and look_id is null and pieces is null)
  or (product_id is null and product_image is null and look_id is not null and pieces is not null)
);

create index try_ons_look on try_ons (look_id, started_at desc) where look_id is not null;
