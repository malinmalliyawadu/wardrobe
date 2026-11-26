-- Favourite looks, asked for by Malin on 2026-11-26. Saving keeps a look;
-- wearing one saves it too, so the saved looks grow with every day he wears
-- something. A favourite is the few among them he loves: shown first on the
-- Looks tab, and named to Opus as what says most about his taste.
--
-- A favourite is always a saved look. Favouriting saves it; un-saving,
-- dismissing or remaking it clears the mark (a remake carries it to the look
-- in its place).
alter table looks add column favourite_at timestamptz;
alter table looks add constraint looks_favourite_saved check (favourite_at is null or status = 'saved');
