-- How much the finder may spend on Claude, set by Malin on /you/finder. The
-- same page switches stores on and off, through retailers.enabled.
--
-- One row, like profile and style_guide. Dollars are US dollars, because that
-- is what Anthropic bills. A run may spend up to the nightly cap, and never
-- more than what is left of the monthly cap when one is set; it scores the
-- highest-priority slots first, so a cap cuts the least important.

create table finder_settings (
  id                smallint primary key default 1 check (id = 1),
  max_usd_per_run   numeric(8, 2) not null default 1.00 check (max_usd_per_run >= 0),
  max_usd_per_month numeric(8, 2) check (max_usd_per_month >= 0),
  updated_at        timestamptz not null default now()
);

create trigger finder_settings_updated_at
  before update on finder_settings
  for each row execute function set_updated_at();

insert into finder_settings (id) values (1);
