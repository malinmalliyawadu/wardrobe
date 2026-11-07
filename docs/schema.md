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
| `try_ons` | one per outfit he asks to see on him, more on "Make it again" | A picture of him in a find, a look or pieces he chose: what was sent, its `outfit_key` (the pieces and finds in any order), source photo, provider, cost, the file in the photo store. A kept picture of an outfit is what every card and the chooser show for it |
| `product_cuts` | one per find and photo, read before its first try-on | Claude's read of a find's cut from the shop's photo and listing (fit, and where the seams sit, the room and the length), which the try-on prompt says in words; and what the read cost |
| `wardrobe_pieces` | tens | What he owns: garment, colour, cloth, fit, warmth, what it is worn for (`everyday`, `gym` or `both`), the slot it fills, the product it was bought as |
| `wardrobe_photos` | one per piece photo | Index of photos of his clothes on disk, with the colour read here and Claude's read |
| `find_photos` | one per find added by hand | Index of the photos of finds from a store that cannot be read (Lululemon), on disk under `finds/`; `products.find_photo_id` keeps one from being cleared |
| `look_sets` | one per "Make new looks", and one per outfit of the day | His note, the weather it was dressed for, tokens and cost; `kind` is `set` (Looks tab) or `day` |
| `looks`, `look_pieces` | six a set, fewer as outfits come round again | An outfit from his pieces: occasion (`gym` for a gym fit), weather, why, styling, a wanted slot that would lift it, saved or dismissed with a reason. One look per outfit: a set or a day that puts the same pieces together again offers the look already made, unless he dismissed it |
| `look_set_looks` | six a set, three or four a day | The looks a set offered, in order, new or already made; `looks.set_id` is only the set that first made a look |
| `look_wears` | one per look per day | The days he wore a look, in New Zealand time |
| `look_offers` (view) | one per look per offer | Each set a look was in and each day it was on Today, a day once however often he asked again; what the Worn page and look cards count |
| `day_outfits` | one a day, more when he asks again | The outfit of the day: the date it dresses him for, his note, the forecast it was dressed for, which option is on show, and on a day he trains the gym fit and its line for the day |
| `day_outfit_options` | three a day | The day's options, best first, each a look (an existing one, saved or offered before and not dismissed, when it matches piece for piece) with a sentence for that day |
| `look_images` | one per outfit on show, again when its pieces change | A flat lay of a look drawn by OpenAI from photos of his clothes (never of him): what was sent, its `outfit_key`, cost, the file in the photo store. A look shows the picture of its pieces whichever look it was drawn for |
| `searches` | one per search on the Search tab | What he typed, what it was read as, its limit, what it spent |
| `search_results` | up to 150 a search | The products a search offered Claude, in order, each with its verdict and a re-checked price |
| `statement_candidates` | hundreds a run | What the statement rules picked in a run, with the signals that picked it and the price and sizes in his size |
| `statement_scores` | one per product version | Claude's verdict on a product as a statement piece for him: score, what makes it one, the colour, the why, the pieces it wears with, tokens and cost |

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

**Photos are files, not bytea.** They sit in a private R2 bucket in production
and in `PHOTOS_DIR` locally (`src/lib/storage.ts`), and the table holds the
path, which is the file's key in either, with the hash and dimensions. The database backup stays small and the files can be deleted
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
`garment_kind` (scarf, beanie, cap, gloves, watch, tie for accessories) the rules in
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

**A saved link is an ordinary product.** Pasting a product link from one of
the shops into Saved reads that product from the shop's `/products/<handle>.js`
and writes it through the same `writePage` as the nightly walk, then records
a `saved` action whose `slot_id` may be null (a want that is not for a slot).
The nightly run re-reads any saved product its walk did not see, one request
each, so a linked product outside the men's collection keeps a current price
and stock, and one the shop has delisted is marked removed. No new table.

**Saved finds are tracked from `price_observations`, with no new table**
(M4). Each saved find's observations are replayed in `src/lib/saved-history.ts`
into the moments its lowest in-stock price changed, counting only the
variants in his size when the size is known (the slot's size labels first,
then the profile, as the filter reads them). Consecutive moments give the
events: cheaper, dearer, sold out, back. The newest event, when it came during
the latest run and is not a rise, is the night's news: a line on the find and
a summary under Saved on Today. A delisted saved product writes an
observation for each size it still had, so it reads as sold out on the night
it went.

**Finder settings (migration 0004)** are a one-row table, like the profile:
the nightly and monthly caps on Claude spend, in US dollars because that is
what Anthropic bills. A run's budget is the nightly cap (or `--max-usd`), held
under what is left of the month, counted in New Zealand time from each run's
`stats.usd`. Which stores are read is `retailers.enabled`, switched on
/you/finder; the seed sets it only when a store is first added, so the file
never undoes the switch. A store switched off is neither read nor shown.

**Try-ons (migration 0005)** are a row per image asked for, never per find
shown: they are made on request only. The row records the product, the
full-length photo he was dressed from, the product photo as listed (a new
listing photo is a new try-on), the provider and model, the prompt and
settings, the provider's request id (what a deletion request to them needs),
the tokens it reported and what they cost. A unique index on `status =
'making'` holds the one-at-a-time rule in the database. The image is a file
under `try-ons/` in the photo store, served only through `/photos/try-ons/:id`.
Deleting a photo deletes the try-ons made from it, and "delete photos" all of
them; the rows stay, with `path` cleared and `deleted_at` set, so the spend is
still counted. A remake is a new row, so an id's bytes never change.

**The wardrobe (migration 0006)** is what he owns; the blueprint is what he
should own. A piece fills at most one slot, and a slot is filled by at most
one piece still in the wardrobe (a unique index on `slot_id` where
`set_aside_at` is null). The rule tying them is "a slot is owned exactly when
a piece fills it", held in `src/lib/pieces.ts` from both sides: anything that
changes slot statuses (a status tap, a redraft, a refill, "Bought it") runs
`syncSlotPieces`, which makes a piece from each owned slot that has none and
lets go of pieces whose slot is no longer owned; a piece made only from its
slot (never edited, no photo) is deleted then, one he has touched is kept and
unlinked. From the piece side, linking owns the slot, and unlinking, setting
aside or deleting hands it back (or retires it, his choice on set aside).
"Bought it" makes the product a piece (`source = 'find'`) with the shop's
title, brand and photo, the slot's colour and cloth and the size in stock.
The migration made a piece of every slot already owned.

**Piece colours are guide hexes where they fit.** A colour read from a photo
(on our own server by `photo-colour.ts`, or named by Claude from the palette
list) is snapped to the nearest best colour or neutral within a CIE76
distance of 12, and kept as its own hex otherwise, so the Pieces page can say
how much of the wardrobe is in his palette.

**Piece photos are their own table**, not `profile_photos`: they are not
pictures of him, so "delete photos" leaves them, and a piece's photo goes
with the piece. The row exists before the piece: the add form reads the photo
first and he confirms, so a photo no piece took is cleared after a day. The
row keeps the local colour read and Claude's read with its tokens and cost,
to compare with what he saved. A piece bought from a shop shows the shop's
photo until he adds his own.

**Looks (migration 0007)** are made a set at a time, on his tap. A set keeps
what it cost and the context it was made in, so the spend is on the page. A
look's pieces are rows in `look_pieces` in layer order (outermost first, then
down to the shoes, then what is carried); deleting a piece deletes its row
there, and `piece_count` lets the look say a piece is gone. Status is `new`,
`saved` or `dismissed`, and a dismissal must carry its reason (a check
constraint). Wearing a look logs the New Zealand date, once a day per look,
and saves it. The Looks page shows the newest set less what he dismissed,
then the looks he saved from earlier sets; the next set is told his saved and
dismissed looks (with reasons) and how often each piece was worn in the last
three weeks.

**Searches (migration 0010)** are the request and its own target, never a
blueprint slot: the read (garment, colour words and families, price, cut,
words to rank by) is stored on the search as the same `SlotTarget` the filter
takes for a slot, with slot id 0, and the scorer is shown it as the only slot.
Their verdicts go in `search_results`, not `product_scores`: they answer his
words, not a slot, and must not stand in for a nightly verdict. A row is
written for every product offered, in the order offered (closest to his
words first), so the page can count progress and a capped search shows what
it did not reach. `in_stock`, `sizes` and the price are rewritten by the
re-check after scoring. One search runs at a time (a unique index on the
running statuses, like the one try-on in the making), and one still running
after 15 minutes is read as failed. `finder_settings.max_usd_per_search` is
the per-search limit; the month's spend counts `searches.usd` with the runs'.
A saved search result is an ordinary `feed_actions` row with no slot, saved at
the price and size the search found.

**Statement pieces (migration 0017)** keep their own verdicts, apart from
`product_scores`: a slot verdict asks whether a product fills a slot, a
statement verdict whether it carries an outfit, and the same product can be a
poor match for every slot and a fine statement. Both are keyed by
`(product_id, content_hash)`, so a version is judged once each way. A run's
statement shortlist is `statement_candidates`, like `finder_candidates`, and
the shelf reads the newest run that has one. `wears_with` is an array of
wardrobe piece ids with no foreign key, as it was when judged; a piece
deleted or set aside since is dropped when the shelf reads it. A save from
the shelf is an ordinary `feed_actions` row with no slot, at the price and
size the run found in his size. `finder_settings.max_usd_statements` is the
nightly cap, and a run's `stats.usd` is both stages together, so the month
counts it.

## Expected growth

Reading the men's collections, the eleven stores came to 29,048 products and
157,442 variants on the first ingest (2026-11-04), END. alone 19,857 and
116,016. Nightly deltas are hundreds. Nothing here needs partitioning for
years.
