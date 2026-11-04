-- M3: the nightly finder.
--
-- Retailers learn where their feed lives (Crane Brothers serves its public
-- site headless, so the feed is on its myshopify host), which collections hold
-- the men's range when the store sells more than menswear, and whether the
-- whole catalogue is menswear. Products carry the garment type the rules gave
-- them, variants a normalised size key, so the filter is plain SQL. Each run
-- records the candidates that passed the filter, and the feed reads the latest
-- run. The reasoning is in docs/schema.md.

alter table retailers
  add column feed_url         text,
  -- Collection handles to read instead of the whole catalogue. A product in
  -- one of them counts as menswear.
  add column feed_collections text[] not null default '{}',
  add column catalogue        text not null default 'mixed' check (catalogue in ('menswear', 'mixed')),
  add column notes            text;

alter table products
  add column garment_type text check (garment_type in (
    'tee', 'polo', 'shirt', 'overshirt', 'knitwear', 'sweatshirt',
    'trousers', 'jeans', 'shorts', 'tailoring', 'jacket', 'coat',
    'activewear', 'shoes', 'boots', 'sneakers', 'accessory', 'bag')),
  -- Narrows accessories ("belt", "scarf", "hat", "watch"), so a cap is never
  -- compared with a belt slot.
  add column garment_kind text,
  -- The dominant colours (hex) read from the main photo when the listing
  -- names no colour (END. never does), and the photo they were read from, so
  -- a new photo is read again and an unchanged one never is. Families are
  -- derived from the hexes when the filter runs, so the rules can change
  -- without reading a photo twice.
  add column image_colour_src text,
  add column image_colours    text[];

create index products_open_garment on products (garment_type)
  where removed_at is null and menswear;

-- "S", "W30", "EU42", "UK8", "US9", "ONE". Null when the label is not a size
-- the rules understand; such a variant only matches when his size is unknown.
alter table product_variants
  add column size_key text;

alter table finder_runs
  add column options jsonb not null default '{}'::jsonb;

alter table product_scores
  add column run_id             bigint references finder_runs (id) on delete set null,
  add column colour_option      text,
  add column served_by          text,
  add column cache_read_tokens  integer,
  add column cache_write_tokens integer,
  add column usd                numeric(10, 6);

-- What passed the filter in each run. The feed shows the latest run's
-- candidates whose score clears the threshold.
create table finder_candidates (
  run_id           bigint not null references finder_runs (id) on delete cascade,
  product_id       bigint not null references products (id) on delete cascade,
  content_hash     text not null,
  slot_ids         bigint[] not null,
  -- Size labels in stock that match his sizes, as the retailer writes them.
  sizes            text[] not null default '{}',
  -- False when his size for this garment is not on the profile yet, so the
  -- size check was skipped rather than passed.
  size_known       boolean not null,
  -- Lowest matching in-stock price, in the retailer's currency.
  price_cents      integer not null check (price_cents >= 0),
  compare_at_cents integer check (compare_at_cents >= 0),
  primary key (run_id, product_id)
);

create index finder_candidates_product on finder_candidates (product_id);

-- Save remembers the price it was saved at, so a drop can be shown. "cleared"
-- undoes a save or a dismissal; the latest row per product still wins.
alter table feed_actions
  add column price_cents integer check (price_cents >= 0),
  add column size        text;

alter table feed_actions drop constraint feed_actions_action_check;
alter table feed_actions
  add constraint feed_actions_action_check
  check (action in ('saved', 'dismissed', 'bought', 'cleared'));
