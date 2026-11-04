-- M5: looks. Outfits Claude puts together from the pieces he owns, against
-- his style guide, proportions, week and Wellington's weather. Made on his
-- tap, a set at a time, never overnight. A look is saved, dismissed with a
-- reason (which the next set reads), or worn, which is logged by day so the
-- next set rotates in what he has worn less.

create table look_sets (
  id            bigint generated always as identity primary key,
  -- What he asked for, if anything: "a wedding on Saturday".
  note          text,
  -- The month, the weather it was dressed for and how many pieces it had.
  context       jsonb not null default '{}'::jsonb,
  model         text not null,
  served_by     text,
  input_tokens  integer,
  output_tokens integer,
  usd           numeric(10, 6),
  -- How many looks Claude proposed before the app's checks dropped any.
  proposed      smallint not null default 0,
  created_at    timestamptz not null default now()
);

create table looks (
  id             bigint generated always as identity primary key,
  set_id         bigint not null references look_sets (id) on delete cascade,
  position       smallint not null,
  title          text not null,
  occasion       text not null check (occasion in ('office', 'weekend', 'evening', 'travel')),
  -- The Wellington day it is dressed for, in a few words.
  weather        text not null,
  why            text not null,
  styling        text,
  -- One wanted slot that would lift the look, and why.
  better_slot_id bigint references blueprint_slots (id) on delete set null,
  better_why     text,
  -- How many pieces it was made with, so a look can say when one is gone.
  piece_count    smallint not null,
  status         text not null default 'new' check (status in ('new', 'saved', 'dismissed')),
  dismiss_reason text check (dismiss_reason in ('colours', 'too_dressy', 'too_casual', 'weather', 'not_me')),
  acted_at       timestamptz,
  created_at     timestamptz not null default now(),
  check ((status = 'dismissed') = (dismiss_reason is not null))
);

create index looks_set on looks (set_id, position);
create index looks_status on looks (status, acted_at desc);

create table look_pieces (
  look_id  bigint not null references looks (id) on delete cascade,
  piece_id bigint not null references wardrobe_pieces (id) on delete cascade,
  position smallint not null,
  primary key (look_id, piece_id)
);

create index look_pieces_piece on look_pieces (piece_id);

-- A day he wore a look, in New Zealand time. Once a day per look.
create table look_wears (
  id         bigint generated always as identity primary key,
  look_id    bigint not null references looks (id) on delete cascade,
  worn_on    date not null default ((now() at time zone 'Pacific/Auckland')::date),
  created_at timestamptz not null default now(),
  unique (look_id, worn_on)
);
