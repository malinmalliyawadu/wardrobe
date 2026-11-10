-- An outfit from scratch, asked for by Malin on 2026-11-10: on the Wardrobe
-- tab's Outfit page he says what it is for ("a wedding on Saturday") and what
-- it is made from: his wardrobe, the shops, or both. One outfit comes back.
--
-- From the shops, Sonnet first reads the brief into the garments to look for,
-- the nightly filter finds them in his size over what the last run read, and
-- Opus puts the outfit together from the closest of each. From his wardrobe,
-- Opus dresses him from his pieces alone. From both, Opus wears what he owns
-- and buys what he lacks.

create table outfits (
  id          bigint generated always as identity primary key,
  -- What he said it is for, as he typed it. Empty when he gave none.
  brief       text not null default '' check (char_length(brief) <= 300),
  source      text not null check (source in ('wardrobe', 'shops', 'both')),
  status      text not null default 'making' check (status in ('making', 'ready', 'failed')),
  -- Where it is while it is being made, for the page's one line.
  stage       text not null default 'planning' check (stage in ('planning', 'looking', 'composing')),
  title       text,
  occasion    text,
  weather     text,
  why         text,
  styling     text,
  -- An outfit made only of his pieces is a look like any other, in a set of
  -- its own kind: saving, wearing, changing its pieces and its pictures are
  -- the look's. A remake takes the look's place in the set, so the outfit
  -- follows it.
  set_id      bigint references look_sets (id) on delete set null,
  -- Counts, the exchange rates it priced with, and what each call cost.
  stats       jsonb not null default '{}'::jsonb,
  usd         numeric(10, 6) not null default 0,
  -- In words for him, when it failed.
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- One in the making at a time, held by the database like a search.
create unique index outfits_one_making on outfits ((true)) where status = 'making';

create index outfits_started on outfits (started_at desc);

-- What the outfit is made of, the outermost layer first: a piece of his, or a
-- product from the shops with the price and sizes found for him when it was made.
create table outfit_items (
  outfit_id        bigint not null references outfits (id) on delete cascade,
  position         smallint not null,
  piece_id         bigint references wardrobe_pieces (id) on delete cascade,
  product_id       bigint references products (id) on delete cascade,
  -- A few words on why this one, for a product.
  why              text,
  -- In the store's currency, in his size.
  price_cents      integer,
  compare_at_cents integer,
  sizes            text[] not null default '{}',
  size_known       boolean not null default false,
  primary key (outfit_id, position),
  check ((piece_id is null) <> (product_id is null))
);

create index outfit_items_product on outfit_items (product_id) where product_id is not null;

-- The set an outfit of his own pieces is offered in.
alter table look_sets drop constraint look_sets_kind_check;
alter table look_sets add constraint look_sets_kind_check check (kind in ('set', 'day', 'piece', 'ask'));
