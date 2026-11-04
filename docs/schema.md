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
changed is never re-sent to Claude. A changed title, image or price produces a
new hash and a new score, and the old one stays for comparison.

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

## Expected growth

Eleven Shopify stores produce roughly 15,000 products and 60,000 variants on
the first ingest. Nightly deltas are hundreds. Nothing here needs partitioning
for years.
