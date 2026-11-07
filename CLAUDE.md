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
- Photos live in a private Cloudflare R2 bucket in production and in
  `PHOTOS_DIR` locally, never in `public/`, and are served only through
  `/photos/*`. Every read, write and delete goes through `files()` in
  `src/lib/storage.ts`; a row's `path` is the file's key in either store. Masters are 1568px
  JPEGs with no metadata; the row holds the hash and the dimensions.
- `npm test` creates and drops its own scratch database for the migration
  test. Never point the test at a database you care about anyway.
- Claude calls go through `src/lib/claude.ts`. Models are named once there:
  Opus for the rare, quality-sensitive calls, Sonnet for nightly scoring.
- Try-on images come from OpenAI (`OPENAI_API_KEY`), only through
  `src/lib/try-on.ts`, only on Malin's tap, one at a time, of a find or of a
  whole look. The one image made without a tap is the outfit of the day's
  flat lay (`src/lib/look-image.ts`), from photos of his clothes, never of
  him. The photo rule in docs/plan.md 1.1 is what he agreed; do not send his
  photos anywhere else.
- Fonts are committed under `src/fonts` and loaded with `next/font/local`; the
  Docker build runs with the network off and will fail on any build-time fetch.
- Plain dash, never an em dash, in copy and comments.

## Design

Redesigned 2026-11-05; the reasoning is in `docs/design.md`, read it before
touching any page. A lookbook, laptop first (Malin reads it there), the phone
the same content in one column. Tokens live in `src/app/globals.css`. Ground
is uncoated stock by day and pine black by night; every product and piece
photo sits on a white sweep in both. Ink is the type and the one solid button
on a screen; bottle green is the only accent and marks the active thing. One
typeface, Instrument Sans (variable weight and width), condensed and heavy
for the few words that carry a screen, normal for everything read. No
gradients, no serif, no pills, no tracked caps labels, no hairline rules
between sections (space and a `.caption` instead), no middle dots. Colour
otherwise is Malin's own palette as flat swatches: the strip beside the
wordmark on every page, a slot's colours, a piece's colour. Every swatch
carries its name as `data-colour` (the `name` prop on `Swatch`), and
`src/components/colour-tip.tsx` in the app layout shows it under the mouse.

Tabs, by how often each is opened: Today (the outfit of the day and nothing
else), Finds (`/finds`: ask the shops, the way into Statement pieces, last
night's finds, the way into Shops), Wishlist (`/wishlist`: what he saved and the links he pasted, with
what changed; he opens it in a shop to decide whether to buy), Wardrobe (`/wardrobe`, with Looks, On me and Worn under its name; a
piece is `/wardrobe/[id]`), Blueprint, You. Old `/looks/*` paths redirect
from `next.config.ts`.

Motion rules, from the animate skill: transform and opacity only, `--ease-out`
for entrances, UI transitions under 300 ms, press feedback is `.pressable` or
`.btn` (scale 0.97 at 160 ms), every animation has a `prefers-reduced-motion`
variant. No page-load animation anywhere: the picture is the arrival. Motion
only answers a tap (a crossfade when content swaps in place, a card leaving
after an action, the viewer opening).

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
`http.ts`): thirteen Shopify stores from `data/retailers.json`, one request a second per
host, robots.txt read once per host per run, about 2.5 minutes. Country Road,
Good As Gold, Huffer and END. are read through their men's collections;
Crane Brothers through its myshopify host. Patagonia NZ (added 2026-11-05,
its own NZD shop, read through `mens`) is mostly technical kit that the
rules file as activewear, so its finds are the casual fleece, shirts and
pants. Bronze Snake (added 2026-11-07) is a Melbourne label in AUD that
ships here, read through `mens`; its feed rate-limits like Patagonia's. LSKD (added 2026-11-07, Malin's ask
for gym tanks) is a Gold Coast activewear shop that ships here, links only by
his call: a Shopify store that starts switched off, so a pasted link is read
and a saved one re-read each night, but it is not walked. Rodd & Gunn (added 2026-11-05, migration 0019, platform
`rodd-and-gunn`, `rodd-and-gunn.ts`) is links only, like Uniqlo, Malin's
call: it is not Shopify and its catalogue is a page per colour (about 2,540),
most of an hour a night at a page a second, so it is never walked and has no
switch. A pasted link is read from its NZ page with stock per size, and a
saved one is re-read each night. A colour's leg lengths are separate pages
and ids on the site and one product here, under the Regular id.
`WALKED_PLATFORMS` and `STOCK_PLATFORMS` in `src/lib/retailers.ts` say which
stores have a switch and which know stock per size; SQL uses them, never a
platform name. Product photos are sized through `src/lib/product-image.ts`
(Shopify and Uniqlo take `width`, Rodd & Gunn's image service `sw`). Filter (`filter.ts`,
`classify.ts`, `colour.ts`, `photo-colour.ts`): rules and SQL only, including
a colour rule that only ever says no and reads the main photo once (cached as
hex) when a listing names no colour, as END.'s never do. Score (`score.ts`):
Sonnet 5.5, adaptive thinking at low effort, zod structured output, the run's
context (profile, guide, open slots, recent dismissals) one cached system
block, about $0.0074 a product; stops after ten API errors in a row.
/you/finder sets the spend (a nightly cap, default US$1, and an optional
monthly one) and switches stores on and off, with each store's shortlist,
finds and cost from the last run. Its "Run now" spawns `scripts/find.ts` as a
child of the web server (`src/lib/finder/start.ts`) and polls
`/api/finder/run` while it goes. One run at a time: the script holds a
Postgres advisory lock for its life (`src/lib/finder/runs.ts`), so a second
run logs `find.busy` and exits, and a `running` row without the lock is a run
that died; the next run closes it. Saved on Today also takes a pasted
product link from any of the shops (`src/lib/finder/product-link.ts`), with
or without a slot; the nightly run keeps those current too. Uniqlo (added
2026-11-05, migration 0010) is links only: platform `uniqlo`, never walked
and no switch, since it has no NZ online store. Each region is its own
store row (Uniqlo AU, Uniqlo US, added 2026-11-05 because many US products
and colours are 404s on the AU site), and `retailerForLink` sends a link to
the store whose site path it sits under, else to the one added first on the
host (AU), so a UK or JP link is read from AU. `src/lib/finder/uniqlo.ts`
reads the product page's preloaded state,
stores each colour as its own product, and has no per-size stock, so cards
say the sizes it makes rather than what is in stock. The feed
on Today (`src/components/feed/`, `src/lib/feed.ts`) shows the newest run with
recorded candidates, including one still scoring; save, dismiss with a reason
and bought move the slot's status. First pass numbers and what is left to
score are in docs/plan.md under M3. His waist and shoe sizes are not on the
profile, so trousers and shoes show every size in stock until he adds them.
Shops (`/shops`, `src/lib/shops.ts`, linked from the finds on Today) is
everything the finder read, searchable by words (variant colours included),
kind, shop and his size: Claude's matches for open slots first, then the
shortlist still waiting to be judged, then the rest. Save there is the feed's
save, for a slot or none. What it marks as on Today comes from
`shownOnToday` in feed.ts, which a test holds to `getFeed`.

M3.5 try-on built 2026-11-04 with OpenAI (`gpt-image-2.5-sunburst`, high,
his photo's aspect), chosen by Malin over the recommended FASHN; the research
and the agreed photo rule are in docs/plan.md. Gate pending: a week of
try-ons he finds honest enough to change what he buys. A find's cut goes into
the prompt in words (`src/lib/garment-cut.ts`, migration 0021, 2026-11-07):
left to the photo, the editor fitted an oversized overshirt close to him, so
Sonnet reads the shop's photo and listing once per find and photo, when its
first try-on is made, and says where the seams sit, the room and the length;
his own find photos are never read. A piece of his says the fit it is filed
as.

M4 deploy and polish built 2026-11-04; gate pending (Malin using it on
Coolify, from his phone). GitHub: `malinmalliyawadu/wardrobe`, public, CI on
every push and PR. The sign-in is a password screen, not Basic Auth (Malin's
choice: an installed iPhone app handles a Basic Auth prompt badly):
`src/proxy.ts` gates everything but static files, the manifest, the icons
and `/api/health/live`; `APP_PASSWORD` unset leaves local dev open; the cookie
is an HMAC keyed by the password and lasts a year (`src/lib/auth.ts`). The
tabs live in the `(app)` route group so `/login` has no nav. Deploying is the
README's click-through (Postgres, the data carried across, the photos in a
private R2 bucket, the finder as a scheduled task with a 3600 s timeout).
Photos moved off the `/data` volume to R2 on 2026-11-07, Malin's call so
they do not fill the Coolify server: `src/lib/storage.ts` (aws4fetch, all
four `R2_*` settings or none, the folder in dev and tests) and
`npm run photos:move` (copy, MD5 check, `--prune`), with the README's
one-time steps for the running deploy. The container
health check is `/api/health/live` (database only); `/api/health` adds Claude
and whether the photos folder is writable. Icons are the palette strip,
drawn by `scripts/icons.ts` into `public/icons` and `src/app`; no service
worker. Saved finds are tracked by replaying `price_observations` in his size
(`src/lib/saved-history.ts`): the newest change from the latest run is news,
on the row and summed up under Saved. Loading states are skeletons from
`src/components/skeleton.tsx`, held back 300 ms so a quick load shows nothing.

M5 wardrobe and looks built 2026-11-04 (migrations 0006, 0007), agreed with
Malin first; gate pending (he adds what he owns and would wear the looks). A
Wardrobe tab (`src/app/(app)/wardrobe/`, Looks and Pieces; it was the Looks tab until the 2026-11-05 redesign). Pieces
(`src/lib/pieces.ts`) hold the rule that a slot is owned exactly when a piece
fills it: slot-side changes run `syncSlotPieces`, piece-side changes set the
slot themselves, and "Bought it" makes the find a piece. Clothing photos
(`src/lib/piece-photos.ts`) are their own table and files under
`PHOTOS_DIR/wardrobe`, read once by Sonnet on add (agreed extension of the
photo rule, docs/plan.md 1.1), and sent to OpenAI only for a look's "See it
on me" (migration 0008, his own photo of a piece first, else the shop's,
else words). Looks
(`src/lib/looks.ts`) are Opus through `generate()`, from the pieces' words
only; `tidyLooks` drops any look that is not a whole outfit. A set takes a
minute or two and US$0.15 to 0.32.

On me (`/wardrobe/on-me`, the Wardrobe tab's third page, `src/lib/on-me.ts`) lists
every try-on still kept, newest first, each with what it was made from, and
its own page shows the prompt and "Make it again". "Choose pieces" puts any
mix of his pieces and saved finds on him in one image (migration 0009: a
try-on with neither a find nor a look, only `pieces`), in layer order, with
whatever he did not choose left as it is in his photo.

One outfit is made once, everywhere (migration 0016, Malin's ask
2026-11-05). A set of looks, the outfit of the day and a remake offer the
look already made with the same pieces (`matchingLooks`, `offerLook` in
looks.ts, `sameLook` in look-remake.ts; a set's looks are `look_set_looks`,
and a remake takes the old look's place there), unless he dismissed it or a
remake replaced it. Every try-on and flat lay
carries an `outfit_key` (`src/lib/outfit-key.ts`: "p12" pieces and "f34"
finds, sorted), and a card, a look or the "Choose pieces" chooser shows the
kept picture of its outfit whichever look, find or choice it was made for; a
tap that would make it again gets that one (`reused`). Only "Make it again"
(`again`) pays for a second.

M5 Reach built 2026-11-04 (migration 0010); gate pending (a week of searches
whose finds he would buy, at a cost he is happy with). The three store
adapters were researched (docs/plan.md, M5) and not built, Malin's call:
THE ICONIC's terms forbid robots and scraping, Uniqlo does not sell to NZ,
and Hallensteins was left out; the finder stays on the eleven Shopify stores.
On-demand search is a Search tab (`src/app/(app)/search/`, `src/lib/search.ts`):
Sonnet reads the request into a `SlotTarget` (slot id 0, never a real slot),
the nightly filter runs with it over what the last run read, Sonnet judges
the closest to his words first within `finder_settings.max_usd_per_search`
(US$0.50, counted in the month), and what will be shown is re-read from the
shop. The work runs in `after()`; the page refreshes itself while it runs.
Verdicts go in `search_results`, never `product_scores`. No slot is made;
results save without one, and "Add to blueprint" prefills `/blueprint/new`.
First real search: 51 judged, 7 finds, US$0.33, 40 s.

Outfit of the day built 2026-11-05 (migration 0012); gate pending (a week of
days he wears what it suggests). On Today between the hero and the finds
(`src/components/day/`, `src/lib/day-outfit.ts`): the first opening of a day
(from 6pm, tomorrow) starts it through an action, never a render; Opus makes
three options from his pieces against Open-Meteo's forecast for 7am to 10pm
(`src/lib/weather.ts`), the season and his week, in `after()`, and the card
refreshes until it is there. Each option is a look (an existing one, saved
or offered before and not dismissed, when it matches piece for piece, so its
flat lay is not drawn again); day sets are `look_sets.kind = 'day'` and never
the Looks tab's newest set. Every option keeps to the day's warmth limit
(`src/lib/warmth.ts`, 2026-11-07, after Malin found them three layers and
wool on warm days): read from the warmest the day feels (feels-like already
counts the wind), it caps layers on the body and warm pieces and rules out
knits and coats on hot days; the prompts state it, `tidyDay` drops an option
over it, and a piece with no warmth set has it read from its garment and
cloth. The option on show gets a flat lay drawn by
OpenAI from photos of his clothes, never of him (`src/lib/look-image.ts`,
served at `/photos/looks/:id`): the photo rule's one no-tap exception,
docs/plan.md 1.1. About US$0.14 a day.

Gym fits built 2026-11-05 (migration 0014), agreed with Malin first; gate
pending (a week of gym days he wears what it suggests). A piece keeps the
garment it is and says what it is `worn_for`: everyday, gym or both
(`src/lib/wardrobe-values.ts`); everyday looks leave gym-only kit out, and a
gym fit (a look of occasion `gym`) is made only from gym and both pieces,
held by `tidyLooks`. Activewear is no longer offered for a piece: the photo
read and "Bought it" name sport kit for what it is (`kitGarmentOf`,
`asPiece`) and mark it gym, and pieces filed as activewear before became gym
kit that stays out of fits until he names it. Your week takes the days he
trains (`life.gym_days`); on one, the outfit of the day's same Opus call adds
a gym fit (`day_outfits.gym_look_id`), shown under the outfit on Today and
never drawn without a tap. The Looks tab makes a set for his week (a gym fit
or two in it when he trains) or gym fits only. Pieces shelves gym-only kit
as Gym kit.

Changing a look's pieces built 2026-11-05 (migration 0015), asked for by
Malin. "Change pieces" under a look's pieces, on the Looks tab and on
Today's outfit and gym fit, turns them into rows with Swap (for another of
his, Opus's pick) and Remove (nothing in its place; off for a piece the
look cannot stand without, by `wholeWithout` in `src/lib/look-rules.ts`,
which tidyLooks shares), and an optional note. `src/lib/look-remake.ts`
records a `look_remakes` row, calls Opus synchronously in the action
(about 11 s and US$0.05 a remake), and `tidyRemake` holds the answer to
the ask: every kept piece in, every marked piece out, at most one new piece
per swap. The remake is a new look in the old one's set and position, saved
if the old one was, in every current day's outfit that showed it (with a new
line for the day), and handed today's wear; the old look becomes status
`replaced`, kept for its wears. A remade option on show gets its picture
drawn. While a remake is in the making, the card shows it and refreshes;
Today's footer adds what changes cost.

Lululemon added 2026-11-05 as a store added by hand (platform `manual`,
migration 0012): its site answers only robots.txt past a Cloudflare challenge,
which the finder does not pose as a browser to get through. A Lululemon link
pasted on Saved opens fields in `AddLink` for the photo (stored on choice by
`src/lib/find-photos.ts`, under `PHOTOS_DIR/finds`, served by
`/photos/finds/[id]`), name, kind, price, colour and size; `src/lib/finder/manual.ts`
writes it through `writePage` as a product with one variant, one per page
and colour, so adding the same link again updates it. `readable()` keeps
these stores out of every read, the nightly refresh included; the image
loader and `fetchProductImage` take the local photo.

Statement pieces built 2026-11-05 (migration 0017), asked for by Malin, who
chose what a statement is (a bold colour of his, a texture, or a cut or
detail; patterns are not it) and a Claude-picked shelf over a free filter;
gate pending (a week of statement pieces he would buy, at a known cost a
night). The nightly run's fourth stage (`src/lib/finder/statements.ts`):
free rules over everything read, in his size and under the most he would pay
for one of its kind (the profile's budget, else the blueprint's top band),
pick pieces whose listing names one of his best colours that is not a
neutral, a texture word (title and tags), or a cut word (title only, since
stores tag whole categories "Wide Leg"); quilted, herringbone, seersucker,
pleats and a wide leg are left out on purpose. Sonnet judges each once per
version (`statement_scores`) against his profile, guide and everyday pieces,
two signals first, under its own nightly cap (`max_usd_statements`, US$0.50,
inside the month's). The scorer's loop is shared as `judgeAll` in score.ts.
`/statements` (Finds stays lit) shows the latest run's shortlist over 70,
filtered by colour, texture or cut, each card with the pieces it wears with;
a row of the best five sits under the search line on Finds. Saving, dismissing
and buying are the feed's own, and a save takes the price and size the run
found in his size. "See the outfit on me" on a card puts the piece on him with
the pieces it wears with (`startStatementTryOn`, the "Choose pieces" try-on
without the rule that a find be saved; its outfit key finds a kept picture). First real run: 825 picked from 4,070 in his size and
budget, 100 judged in 46 s for US$0.53 (about US$0.005 each), 21 over the
bar; the rest drain at the nightly cap, the best first.

Looks around a piece built 2026-11-05 (migration 0018), asked for by Malin:
"Ways to wear it" on a piece's page (`/wardrobe/[id]`) makes three looks
that each wear that piece, from the rest of his wardrobe, with an optional
note. It is `draftLooks` with `around` (the looks prompt and rules, a piece
ask, `tidyAround` keeps only looks that still wear it), synchronous in
`makePieceLooks` like a set of looks, and saved as a `look_sets` row of kind
`piece` with its `piece_id`, so the Looks tab's newest set stays its own.
`readPieceLooks` shows the newest such set under the page's top spread,
three across on the laptop. Gym-only kit gets gym fits. First run: three
looks in 25 s for US$0.09.

Choosing a find's photo built 2026-11-07 (migration 0020), asked for by
Malin. When a pasted link is read (on the wishlist, or a piece from a shop
link), the shop's photos come up as a row to choose the one it shows, with
"Your own" at the end; a wishlist row has "Change photo" for later
(`src/components/photo-choice.tsx`, `src/lib/product-photos.ts`). The
choice is `products.chosen_image`, which the nightly walk never touches, and
`main_image` (generated: the choice, else the shop's first) is what every
page and try-on reads; choosing the shop's first clears it. The finder's own
reads (the photo colour rule, Claude's look when scoring) keep
`images -> 0`, the shop's photo, since a URL must reach it. His own photo is
a find photo (`find-photos.ts`), kept from the orphan sweep while a product
shows it, and goes nowhere but the try-on editor on his tap, like those of
finds added by hand.

Worn built 2026-11-07 (migration 0022), asked for by Malin to start
discarding outfits and pieces; he chose looks and pieces, a section of its
own, and every offer counted. `/wardrobe/worn` (`src/lib/wear.ts`) records
nothing new: an offer is a set a look was in or a day it was on Today (the
`look_offers` view, a day once however often he asked again), a wear is a
`look_wears` row, and a piece counts through its looks, wears of dismissed
and remade looks included. Rotate out comes first, by a rule the page states
(`rotateOut`: offered 3 times or more and worn on at most one in four, or 14
days owned since looks began with no look wearing it), then saved looks,
other pieces, never in a look, and looks offered and never saved, each most
passed over first, with Dismiss or Set aside on the row. Look cards and a
piece's page carry the same line (`wearLine` in format.ts).
