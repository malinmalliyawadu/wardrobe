# Schema

The contract is `db/migrations/*.sql`, applied in order by `scripts/migrate.ts`.
This file records the reasoning. Applied migrations are never edited; a change
is a new file.

## Shape

Three layers, each derived from the one above, then the finder's tables.

| Table | Rows | What it is |
|---|---|---|
| `profile` | exactly 1 | Who Malin is: colouring, proportions, typed-in sizes, life, taste, budget |
| `profile_photos` | few | Index of photo files on disk. `deleted_at` is the "delete photos, keep profile" action |
| `style_guide` | exactly 1 | What suits him, as structured JSON the finder can read |
| `blueprint_slots` | 30 to 40 | What to own. Each a specific archetype item with a why, priority, budget band, status |
| `retailers` | ~15 | Where the finder looks. `wellington_store` is only shown once verified |
| `products`, `product_variants` | thousands | Normalised retailer catalogue. `content_hash` decides whether a product needs re-scoring |
| `price_observations` | sparse | One row per price or stock change, so a stable price costs nothing |
| `product_scores` | one per product version | Claude's verdict: best slot, score, verdicts, the one-line why, and tokens spent |
| `feed_actions` | append only | saved, dismissed (with a one-tap reason), bought |
| `finder_runs` | one per night | Counts and cost of each run |

## Decisions

**One-row tables use `id smallint primary key default 1 check (id = 1)`**
rather than a settings key-value table. The columns are typed and checked, and
the single-user constraint is enforced by the database instead of by habit.

**Enumerations are `text` with `check` constraints**, not Postgres enums.
Adding a value is an `alter table ... drop constraint, add constraint` in a
migration rather than an enum alteration that cannot run inside a transaction.

**Claude-derived structure is `jsonb`** where its shape is still being designed
(the style guide, the typed-in profile groups). Fields the finder filters on
(undertone, season, slot garment type, budget) are real columns so SQL can use
them.

**Scores are keyed by `(product_id, content_hash)`.** A product that has not
changed is never re-sent to Claude. A changed title, description, tag, photo
or set of colours produces a new hash and a new score, and the old one stays
for comparison. Price and stock are deliberately not in the hash (migration
0003 changed this from the first plan): the scorer is never shown the price,
because the filter owns the budget, so a sale or a size selling out must not
pay for a second score. They are read fresh every night instead, and land in
`price_observations`. Photo URLs are hashed without Shopify's `?v=`
cache-buster.

**Money is integer cents plus a currency on the retailer.** Prices from END.
are GBP and are converted for display, never stored converted.

**Photos are files, not bytea.** They sit in `PHOTOS_DIR` (a Coolify volume at
`/data/photos` in production) and the table holds the path, hash and
dimensions. The database backup stays small and the files can be deleted
independently of the profile derived from them.

**The style guide is one jsonb column per section** (`palette`,
`silhouette`, `shoes`, `accessories`, `fit_vocabulary`), each validated by the
zod schemas in `src/lib/style-guide.ts` on the way in and out. A row whose
shape no longer parses reads as "no guide" rather than crashing a page.

**Slots record who changed them** (migration 0002). `edited_at` is set by the
edit form only, never by a status change or a reorder, and a redraft keeps
every slot Malin wrote (`source = 'malin'`), edited, owns or has a candidate
for; it replaces only Claude's untouched wanted and retired slots.
`replaces_id` links a refill to the retired slot it took over from, unique so
a retired slot is refilled once. `garment_type` and `fit` gained check
constraints because the finder filters on both; the lists live in
`src/lib/wardrobe-values.ts` and `src/lib/profile-values.ts`.

**Slot colours are hex values from the guide palette**, so the swatches and
the finder speak the same palette. The colour name is looked up from the
guide; `colour_family` carries the plain words a product title would use.

**The finder (migration 0003).** Retailers carry `feed_url` (Crane Brothers'
public site is headless, so its feed is read from the shop's myshopify host
while links go to the public site), `feed_collections` (the men's collection
to read instead of the whole catalogue: Country Road's is 2,700 products of
22,600, and END.'s whole catalogue is past Shopify's 25,000-product page
limit while its men's collection is not), and `catalogue` (`menswear` when
every product is men's or unisex). Products carry the `garment_type` and
`garment_kind` (belt, scarf, beanie, cap, watch for accessories) the rules in
`src/lib/finder/classify.ts` gave them, and variants a normalised `size_key`
("S", "S/M", "W32", "EU42", "C46", "ONE"), so the filter is one SQL statement
over keys rather than string matching. The rules run at every ingest, so a
rule change reaches the whole catalogue the next night; `--reclassify`
re-applies them without reading the stores.

**The colour rule is the filter's, not Claude's, and only ever says no.** A
product is dropped from a slot when every colour its listing names is in a
family the slot is not in or next to (`src/lib/finder/colour.ts`). When the
listing names none (END. never does), the main photo is read instead
(`photo-colour.ts`: border as background, k-means in CIELAB). What is kept is
the photo's dominant colour or two, as hex, in `image_colours`, keyed on
`image_colour_src`, so each photo is read once; families are derived from the
hexes every run, so a rule change never needs a photo read twice. An unsure
read keeps the product for Claude.

**`finder_candidates` is per run.** The feed reads the latest succeeded run's
candidates joined to their current score, so what Today shows is exactly what
passed last night, and a run's counts can be compared with any other's.
`size_known` is false when his size for that garment is not on the profile,
so the card says "in stock" rather than "your size".

**Feed actions stay append-only.** `cleared` (added in 0003) undoes a save;
the latest row per product wins. A save records the price it was saved at,
which is how a price drop is shown. Saving makes a wanted slot `candidate`,
clearing or dismissing the last saved find makes it `wanted` again, and
buying makes it `owned` (`recordAction` in `src/lib/feed.ts`).

**Finder settings (migration 0004)** are a one-row table, like the profile:
the nightly and monthly caps on Claude spend, in US dollars because that is
what Anthropic bills. A run's budget is the nightly cap (or `--max-usd`), held
under what is left of the month, counted in New Zealand time from each run's
`stats.usd`. Which stores are read is `retailers.enabled`, switched on
/you/finder; the seed sets it only when a store is first added, so the file
never undoes the switch. A store switched off is neither read nor shown.

## Expected growth

Reading the men's collections, the eleven stores came to 29,048 products and
157,442 variants on the first ingest (2026-11-04), END. alone 19,857 and
116,016. Nightly deltas are hundreds. Nothing here needs partitioning for
years.
