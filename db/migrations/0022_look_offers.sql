-- How often a look was put in front of him, asked for by Malin on 2026-11-07
-- to see what he is offered and never wears, and discard it.
--
-- One row per look per offer: a set of looks it was in (on the Looks tab, or
-- around a piece), or a day it was one of the outfit of the day's options or
-- the gym fit. Asking again on the same day makes a second day set, but it is
-- the same day, so a day counts once. A remake takes over the old look's
-- offers (look-remake.ts moves its look_set_looks rows), so they count for
-- the look now in their place.
create view look_offers as
select distinct
  lsl.look_id,
  case when d.for_date is not null then 'd' || d.for_date::text else 's' || s.id::text end as offer,
  -- The day it was offered for, when it was on Today.
  d.for_date,
  coalesce(d.for_date, (s.created_at at time zone 'Pacific/Auckland')::date) as offered_on
from look_set_looks lsl
join look_sets s on s.id = lsl.set_id
left join day_outfits d on s.kind = 'day' and d.set_id = s.id;
