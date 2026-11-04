-- Gym fits, asked for by Malin on 2026-11-05. He trains several days a week
-- and wants something to wear to the gym from the kit he owns, on Today on
-- the days he goes and as looks on the Looks tab.
--
-- A piece keeps the garment it is (a tank, shorts, trainers) and says what it
-- is worn for: everyday, the gym, or both (the sneakers he lifts in and wears
-- out). Everyday looks leave gym-only pieces out; gym fits are made only from
-- pieces worn for the gym or both. Activewear was the one place for sport kit
-- and said nothing about what the piece is, so pieces already filed there are
-- gym kit; he names what each one is to put it in a gym fit.
alter table wardrobe_pieces
  add column worn_for text not null default 'everyday' check (worn_for in ('everyday', 'gym', 'both'));

update wardrobe_pieces set worn_for = 'gym' where garment_type = 'activewear';

-- A gym fit is a look like any other, of its own occasion.
alter table looks drop constraint looks_occasion_check;
alter table looks add constraint looks_occasion_check
  check (occasion in ('office', 'weekend', 'evening', 'travel', 'gym'));

-- On a day he trains, the outfit of the day comes with a gym fit too: one
-- look, apart from the everyday options, with its own line for the day.
alter table day_outfits
  add column gym_look_id bigint references looks (id) on delete set null,
  add column gym_today   text;

create index day_outfits_gym_look on day_outfits (gym_look_id) where gym_look_id is not null;
