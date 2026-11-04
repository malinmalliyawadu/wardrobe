# Wardrobe

Malin's personal menswear stylist. Single user, mobile-first web app. Read
`docs/plan.md` for the product and the milestone plan, `docs/schema.md` for the
data model reasoning, and `AGENTS.md` (written by Next) before touching Next.js
APIs: this is Next 16 with Cache Components on, and it differs from older
training data.

## Stack, fixed

Next.js 16 App Router, TypeScript, React 19, Tailwind 4, `postgres.js` with no
ORM, `@anthropic-ai/sdk`, `zod` (one schema each for Claude's output format
and for form parsing), `sharp` (photo resizing and metadata stripping). Node 24
runs the TypeScript in `scripts/` directly.
Docker on Coolify with plain Postgres; the nightly finder is a Coolify scheduled
task running a CLI inside the app image. Ask before adding a dependency.

## Commands

| Command | What |
|---|---|
| `npm run dev` | Dev server (or the `wardrobe` entry in `.claude/launch.json`) |
| `npm run db:migrate` | Apply `db/migrations/*.sql` in order, once each |
| `npm run db:reset` | Drop `public` and rebuild from zero. Local only |
| `npm run health` | Database and Claude reachability from the shell |
| `npm run find` | The nightly finder: ingest, filter, score (options at the top of `scripts/find.ts`) |
| `npm run db:seed-retailers` | Upsert `data/retailers.json` into `retailers` (the finder also does this) |
| `npm run typecheck`, `npm run lint`, `npm test` | What CI runs |

Local Postgres is Homebrew's on 5432, database `wardrobe`. `.env` holds
`DATABASE_URL`; Claude credentials come from `ANTHROPIC_API_KEY` or an
`ant auth login` profile.

## Conventions

- Applied migrations are never edited. The runner refuses a changed checksum.
- Anything that reads Postgres in a page sits under `Suspense` and awaits
  `connection()` first (see `src/components/status-list.tsx`), so the static
  shell prerenders and the data streams.
- Relative imports carry the `.ts` extension so Node can run the scripts;
  `@/` alias imports carry none, because TypeScript cannot rewrite those.
- Forms are Server Actions with `useActionState`. On a validation error the
  action returns `errors` and echoes the submitted `values`; the form merges
  them into its defaults with `withEcho`, because React 19 resets a form once
  its action returns. On success the action `redirect`s back to the hub.
- Every mutation calls `revalidatePath('/', 'layout')` so Today and the hub
  re-read the profile.
- Photos live in `PHOTOS_DIR` (a volume at `/data/photos` in Docker), never
  in `public/`, and are served only through `/photos/[id]`. Masters are 1568px
  JPEGs with no metadata; the row holds the hash and the dimensions.
- `npm test` creates and drops its own scratch database for the migration
  test. Never point the test at a database you care about anyway.
- Claude calls go through `src/lib/claude.ts`. Models are named once there:
  Opus for the rare, quality-sensitive calls, Sonnet for nightly scoring.
- Try-on images come from OpenAI (`OPENAI_API_KEY`), only through
  `src/lib/try-on.ts`, only on Malin's tap, one at a time. The photo rule in
  docs/plan.md 1.1 is what he agreed; do not send his photos anywhere else.
- Fonts are committed under `src/fonts` and loaded with `next/font/local`; the
  Docker build runs with the network off and will fail on any build-time fetch.
- Plain dash, never an em dash, in copy and comments.

## Design

Direction: a menswear lookbook, not a dashboard. Tokens live in
`src/app/globals.css`. Ground is charcoal-navy flannel in the dark and cool
pattern paper in the light; type is chalk-coloured; brass is the only accent
and marks the active thing. Newsreader (variable, optical sizes) for display,
Hanken Grotesk for the interface. No colour gradients. Colour otherwise comes
from Malin's own palette once a profile exists.

Motion rules, from the animate skill: transform and opacity only, `--ease-out`
for entrances, UI transitions under 300 ms, press feedback is `.pressable`
(scale 0.97 at 160 ms), every animation has a `prefers-reduced-motion` variant.
The swatch fan on the empty Today screen is the one page-load sequence; do not
add entrance animations elsewhere.

Mobile baseline is in place: `viewport-fit=cover` with safe-area padding on
the tab bar and main, `100dvh`, 16px inputs, tap highlight off, hover only
under `(hover: hover) and (pointer: fine)`.

## Milestones

M0 scaffold done 2026-11-04. M1 profile built 2026-11-04: the You tab is a hub
with six sub-pages (photos, colouring and proportions, height and sizes, your
week, taste, budget). The Claude read (`src/lib/analysis.ts`, Opus at high
effort with structured output and server-side fallback) was verified only
against a fixture; the M1 gate is Malin running it on his own photos and
agreeing with the read, including the season. Once confirmed, Today's swatch
fan takes the season's colours. Next: M2 style guide and blueprint.

M1 gate, first real run 2026-11-04, on holiday photos (tropical midday sun,
one golden-hour beach shot, later a boat selfie in a grey tee). Every read
landed on deep autumn, runner-up deep winter, at 55 to 60; the photo notes
caught every lighting caveat. Malin confirmed deep autumn from the last read
(four photos, 60). Prompt changes after the first read, schema untouched:
the season "why" must argue the pick against the runner-up on the dimension
that separates them (it had only restated hair, skin and eyes); read the
year-round colouring under a tan; take colouring from the other photo when one
is under coloured light; the summary stays under 70 words, gives clothing
advice only from calls at 60 or above (it had turned a 40-confidence
torso-to-leg guess into trouser-rise advice), and ends with one daylight test
when season or undertone is below 70. The first read ran before height was
entered, so the Photos page now asks for height first. The deep autumn row in
`seasons.ts` was corrected: not "high contrast" (deep autumn is defined by
depth and warmth), gold metal rather than mixed, and a deep teal swatch in
place of a blue-violet that belonged to winter. M1 gate passed. A window-light
face photo would still firm up the season, since 60 on holiday light is a
lean, not a lock. Each
milestone ends with Malin using it and agreeing before the next starts.

M2 built 2026-11-04. M2 gate passed 2026-11-04: Malin read the first draft
(34 slots) and agreed these are things he would buy, in roughly that order.
Next: M3 finder, then M3.5 try-on (see docs/plan.md). `src/lib/style-guide.ts` and
`src/lib/blueprint.ts` make their Opus calls through `src/lib/structured.ts`:
streamed (a whole blueprint outruns a non-streaming timeout), high effort,
server-side fallback, the JSON parsed only after the stop reason is checked,
and every en or em dash Claude writes turned into a plain hyphen. Code holds
Claude to the prompt's rules after the call (`tidyDraft`): slot colours must
be guide hexes, bands are ordered and capped at the category ceiling. Pages:
the Blueprint tab (slots by priority, reorder, retired with refill, redraft
with a note), `/blueprint/[id]` (status on tap, edit, hold to delete),
`/blueprint/new`, `/blueprint/guide` and one editor per guide section. Today's
fan wears the guide's first five best colours. First real run: guide in 81 s
(7.3k output tokens), 34 slots in 90 s (10.2k), a refill in 10 s. Life, taste
and budget were still empty, so the draft assumes office days, weekends and
evenings out and the bands are Claude's NZ estimates; fill those and redraft.
Cache Components keeps visited pages in the DOM hidden by `<Activity>`: in
browser checks, select visible elements only, and key server-fed forms on
what they edit so a return visit shows saved values.

M3 built 2026-11-04; gate pending (a week of daily feed Malin is happy with,
at a known cost per night). `npm run find` runs three stages into one
`finder_runs` row. Ingest (`src/lib/finder/ingest.ts`, `shopify.ts`,
`http.ts`): eleven stores from `data/retailers.json`, one request a second per
host, robots.txt read once per host per run, about 2.5 minutes. Country Road,
Good As Gold, Huffer and END. are read through their men's collections;
Crane Brothers through its myshopify host. Filter (`filter.ts`,
`classify.ts`, `colour.ts`, `photo-colour.ts`): rules and SQL only, including
a colour rule that only ever says no and reads the main photo once (cached as
hex) when a listing names no colour, as END.'s never do. Score (`score.ts`):
Sonnet 5.5, adaptive thinking at low effort, zod structured output, the run's
context (profile, guide, open slots, recent dismissals) one cached system
block, about $0.0074 a product; stops after ten API errors in a row.
/you/finder sets the spend (a nightly cap, default US$1, and an optional
monthly one) and switches stores on and off, with each store's shortlist,
finds and cost from the last run. Saved on Today also takes a pasted
product link from any of the shops (`src/lib/finder/product-link.ts`), with
or without a slot; the nightly run keeps those current too. The feed
on Today (`src/components/feed/`, `src/lib/feed.ts`) shows the newest run with
recorded candidates, including one still scoring; save, dismiss with a reason
and bought move the slot's status. First pass numbers and what is left to
score are in docs/plan.md under M3. His waist and shoe sizes are not on the
profile, so trousers and shoes show every size in stock until he adds them.

M3.5 try-on built 2026-11-04 with OpenAI (`gpt-image-2.5-sunburst`, high,
his photo's aspect), chosen by Malin over the recommended FASHN; the research
and the agreed photo rule are in docs/plan.md. Gate pending: a week of
try-ons he finds honest enough to change what he buys.

M4 deploy and polish built 2026-11-04; gate pending (Malin using it on
Coolify, from his phone). GitHub: `malinmalliyawadu/wardrobe`, public, CI on
every push and PR. The sign-in is a password screen, not Basic Auth (Malin's
choice: an installed iPhone app handles a Basic Auth prompt badly):
`src/proxy.ts` gates everything but static files, the manifest, the icons
and `/api/health/live`; `APP_PASSWORD` unset leaves local dev open; the cookie
is an HMAC keyed by the password and lasts a year (`src/lib/auth.ts`). The
tabs live in the `(app)` route group so `/login` has no nav. Deploying is the
README's click-through (Postgres, the data carried across, a named volume at
`/data`, the finder as a scheduled task with a 3600 s timeout). The container
health check is `/api/health/live` (database only); `/api/health` adds Claude
and whether the photos folder is writable. Icons are the Today swatch fan,
drawn by `scripts/icons.ts` into `public/icons` and `src/app`; no service
worker. Saved finds are tracked by replaying `price_observations` in his size
(`src/lib/saved-history.ts`): the newest change from the latest run is news,
on the row and summed up under Saved. Loading states are skeletons from
`src/components/skeleton.tsx`, held back 300 ms so a quick load shows nothing.

M5 wardrobe and looks built 2026-11-04 (migrations 0006, 0007), agreed with
Malin first; gate pending (he adds what he owns and would wear the looks). A
Looks tab with two pages, Looks and Pieces (`src/app/(app)/looks/`). Pieces
(`src/lib/pieces.ts`) hold the rule that a slot is owned exactly when a piece
fills it: slot-side changes run `syncSlotPieces`, piece-side changes set the
slot themselves, and "Bought it" makes the find a piece. Clothing photos
(`src/lib/piece-photos.ts`) are their own table and files under
`PHOTOS_DIR/wardrobe`, read once by Sonnet on add (agreed extension of the
photo rule, docs/plan.md 1.1), never sent to OpenAI. Looks
(`src/lib/looks.ts`) are Opus through `generate()`, from the pieces' words
only; `tidyLooks` drops any look that is not a whole outfit. A set takes a
minute or two and US$0.15 to 0.32.
