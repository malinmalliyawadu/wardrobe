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

M2 built 2026-11-04, gate pending. `src/lib/style-guide.ts` and
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
