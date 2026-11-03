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
fan takes the season's colours. Next: M2 style guide and blueprint. Each
milestone ends with Malin using it and agreeing before the next starts.
