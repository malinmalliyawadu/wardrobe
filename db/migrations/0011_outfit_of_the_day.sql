-- The outfit of the day on Today. Opus dresses him for one day from the
-- pieces he owns, against that day's Wellington forecast, the season and the
-- day of the week: three options, best first. Each option is a look (a new
-- one, or one he saved before), so saving and "wore it today" are the looks'
-- own and the next set of looks learns from them. The option on show gets a
-- picture: a flat lay of the outfit drawn by OpenAI from the pieces.

-- A day's call is a set of looks like any other, kept apart from the sets he
-- makes on the Looks tab so it never takes the place of the newest of those.
alter table look_sets
  add column kind text not null default 'set' check (kind in ('set', 'day'));

create table day_outfits (
  id          bigint generated always as identity primary key,
  -- The day it dresses him for, in New Zealand. After six in the evening
  -- that is tomorrow.
  for_date    date not null,
  -- What he said was on, when he asked again: "dinner out tonight".
  note        text,
  status      text not null default 'making' check (status in ('making', 'ready', 'failed')),
  -- The forecast it was dressed for (src/lib/weather.ts), or null when none
  -- could be read and it was dressed for the month's usual weather.
  forecast    jsonb,
  -- The call that made it: model, tokens and cost.
  set_id      bigint references look_sets (id) on delete set null,
  -- Which option is on show, counted from 0.
  shown       smallint not null default 0,
  -- In words for him, when it failed.
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- One in the making at a time, held by the database like a search.
create unique index day_outfits_one_making on day_outfits ((true)) where status = 'making';

create index day_outfits_date on day_outfits (for_date, started_at desc);

-- The options, best first. A look he saved before can come back as one.
create table day_outfit_options (
  day_id   bigint not null references day_outfits (id) on delete cascade,
  position smallint not null,
  look_id  bigint not null references looks (id) on delete cascade,
  -- One sentence on why it suits this day: the weather and what is on.
  today    text not null,
  primary key (day_id, position)
);

create index day_outfit_options_look on day_outfit_options (look_id);

-- A picture of a look, without him: a lookbook flat lay drawn by OpenAI from
-- his own photo of each piece, else the shop's photo, else its description.
-- Asked for by Malin on 2026-11-05, extending the photo rule in docs/plan.md
-- 1.1: photos of his clothes (never of him) go to OpenAI without a tap, for
-- the outfit of the day's option on show, one picture per look. A look whose
-- pieces or photos have not changed keeps its picture; a change makes a new
-- one. Files live on the photos volume under looks/, served only through
-- /photos/looks/:id.
create table look_images (
  id            bigint generated always as identity primary key,
  look_id       bigint not null references looks (id) on delete cascade,
  -- The pieces as sent, in order, and how each was shown (PieceSent in
  -- src/lib/try-on.ts), and a key of the same, to tell when it is out of date.
  pieces        jsonb not null,
  pieces_key    text not null,
  provider      text not null check (provider in ('openai')),
  model         text not null,
  status        text not null default 'making' check (status in ('making', 'ready', 'failed')),
  -- Relative to PHOTOS_DIR; null until it is ready.
  path          text unique,
  width         integer,
  height        integer,
  prompt        text not null,
  settings      jsonb not null default '{}'::jsonb,
  request_id    text,
  input_tokens  integer,
  output_tokens integer,
  usage         jsonb,
  usd           numeric(10, 6),
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- One in the making per look, so a second tab never pays twice.
create unique index look_images_one_making on look_images (look_id) where status = 'making';

create index look_images_look on look_images (look_id, started_at desc);
