-- Remaking a look, asked for by Malin on 2026-11-05. On a look Claude put
-- together (on the Looks tab, or an option of the outfit of the day) he marks
-- pieces to swap for another of his and pieces to remove, and Opus remakes
-- the look around the rest, with its words written again.
--
-- The remake is a new look in the old one's place: the same set and position,
-- saved if the old one was, and in every current day's outfit that showed the
-- old one. The old look is kept, as replaced, with the days he wore it, so
-- what he wore stays true and the next set still knows those pieces were worn.
alter table looks drop constraint looks_status_check;
alter table looks add constraint looks_status_check
  check (status in ('new', 'saved', 'dismissed', 'replaced'));

create table look_remakes (
  id            bigint generated always as identity primary key,
  -- The look as it was.
  look_id       bigint not null references looks (id) on delete cascade,
  -- The day's outfit it was changed on, when it was changed on Today, so the
  -- day's cost includes it.
  day_id        bigint references day_outfits (id) on delete set null,
  -- Pieces to swap for another of his, and pieces to remove with nothing in
  -- their place, as ids of wardrobe_pieces when it was asked.
  swap          bigint[] not null default '{}',
  remove        bigint[] not null default '{}',
  -- What he said, if anything: "lighter shoes".
  note          text,
  status        text not null default 'making' check (status in ('making', 'ready', 'failed')),
  -- The look that took its place.
  new_look_id   bigint references looks (id) on delete set null,
  model         text,
  served_by     text,
  input_tokens  integer,
  output_tokens integer,
  usd           numeric(10, 6),
  -- In words for him, when it failed.
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  check (cardinality(swap) + cardinality(remove) > 0)
);

-- One in the making per look, so a second tab never pays twice.
create unique index look_remakes_one_making on look_remakes (look_id) where status = 'making';

create index look_remakes_look on look_remakes (look_id, started_at desc);
create index look_remakes_day on look_remakes (day_id) where day_id is not null;
