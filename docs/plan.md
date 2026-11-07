# Wardrobe - personal styling app

Working title only. Pick a real name before M0 (the folder can be renamed then).

Malin's personal stylist: it learns what suits him (colouring, proportions,
sizes, life in Wellington), turns that into a concrete wardrobe blueprint, and
every night finds real products from NZ and ships-to-NZ menswear retailers that
fill a slot in that blueprint. Single user. Mobile-first web app.

Decisions made on 2026-11-04:

- Mobile-first web app, not native. Next.js App Router + TypeScript +
  `postgres.js` (no ORM), Tailwind 4, Dockerised on Coolify with plain Postgres,
  the nightly finder as a Coolify scheduled task running a CLI. Same shape as
  finance-tracker so the operational knowledge carries over.
- Profile comes from photos analysed by Claude, then confirmed or corrected by
  Malin. Measurements and sizes are typed in.
- Sourcing covers menswear retailers (NZ, with Wellington stores flagged) and
  global retailers that ship to NZ. No womenswear, no secondhand for now.
- Daily in-app feed, no email. The finder runs nightly.

## 1. The model

Three layers, each derived from the one above it. The finder never matches
products against a vague "your style"; it matches them against named slots in
a blueprint. That is what makes every recommendation explainable ("fills your
'dark brown suede chukka' slot, warm mid-brown sits in your palette, 42 EU in
stock at Good As Gold on Victoria St").

### 1.1 Profile (who you are)

Captured once, edited rarely.

| Group | Fields | Source |
|---|---|---|
| Colouring | undertone (warm / cool / neutral / olive), skin depth, hair colour and texture, eye colour, overall contrast (low / medium / high), 12-season palette placement with confidence | Claude vision over 2 to 4 photos, confirmed by Malin |
| Proportions | height, shoulder vs hip, torso vs leg ratio, neck length, build (slim / athletic / broad) | height typed; the rest from a full-length photo, confirmed |
| Sizes | chest, waist, inseam, sleeve, neck, shoe (EU / UK / US), preferred fit per garment type (e.g. relaxed trousers, fitted knit) | typed |
| Life | climate (Wellington: wind, rain, mild, layers year round), contexts with rough weekly split (contract office work, gym 4x, running, weekends, dinners out), travel | typed, short form |
| Taste | 6 to 10 reference images or brands he likes, hard no-gos (logos, skinny fit, whatever), owned staples he is happy with | typed and uploaded |
| Budget | per-category ceiling (tees, knits, outerwear, shoes, accessories) and an overall monthly figure | typed |

Photos are sensitive. They live in a private Cloudflare R2 bucket, never in
the database and never public: the bucket has no public address, the app
reads it with its own key, and the app's sign-in is the only way to see one.
R2 stores them encrypted and does nothing else with them. (Moved there from a
Coolify volume by Malin's call on 2026-11-07, so photos do not fill the
server.) One is sent to the Claude API for the analysis call. One full-length photo is
sent to the OpenAI Images API only for a try-on Malin asks for, one find at a
time, together with the product's own image. OpenAI does not train on API data.
It keeps the request and the result in abuse-monitoring logs for up to 30 days,
processed in the US, and they cannot be deleted sooner without a
zero-data-retention agreement. Results are stored with the photos, and
"delete photos" removes them with the photos. The Anthropic API does not train
on API traffic either. The profile page has a "delete photos, keep the derived
profile" action. (Agreed with Malin on 2026-11-04, with OpenAI as the try-on
provider; see M3.5.)

Photos of his clothes (the wardrobe, M5) are a second kind: not of him. Each
is stored like his photos, without metadata, served only through the app, and
goes to the Claude API (Sonnet) once, when he adds the piece, to fill in the
form he checks. Looks are made from the pieces' words, not their photos.
"Delete photos" stays for photos of him; a clothing photo goes with its piece.
(Agreed with Malin on 2026-11-04.) The one other place a clothing photo goes:
"See it on me" on a look sends his full-length photo to OpenAI with the photos
of that look's pieces (or the shop's photo for a piece he never
photographed), only when he taps it, one image at a time, under the same terms
as a find's try-on. (Asked for by Malin on 2026-11-04.) The same holds for
pieces he chooses himself on the On me page, any mix of his pieces and the
finds he saved: his full-length photo goes with his photo of each piece, or
the shop's photo, on his tap only, one image at a time. (Asked for by Malin on
2026-11-04.)

The outfit of the day on Today has a picture of the outfit without him: a
flat lay OpenAI draws from his own photo of each piece, else the shop's
photo, else its description. This is the one place photos of his clothes go
to OpenAI without a tap: once a day for the option on show, and once more for
each other option he turns to, one picture per look, kept until the look's
pieces or their photos change. His own photo is never part of it; he is in a
picture only through "See it on me", on his tap. (Asked for by Malin on
2026-11-05.)

### 1.2 Style guide (what suits you)

Generated by Claude from the profile, then editable. Persisted as structured
data, not prose, so the finder can use it.

- Colour: best colours (hex plus names), best neutrals, colours to avoid, and
  the metal tone for hardware and accessories (silver vs gold vs mixed follows
  undertone).
- Silhouette and proportion rules written for his height and build: rise,
  hem break, jacket length, where to put visual weight, pattern scale, fabric
  weight.
- Shoe guidance: shapes and heights that work with the trouser rules.
- Accessories: watch size, bag scale, glasses frame guidance, scarves and hats
  for Wellington wind.
- Fit vocabulary per garment type, used to filter retailer fits (slim / regular
  / relaxed / oversized).

### 1.3 Blueprint (what to own)

The core artefact. Roughly 30 to 40 slots, each a specific archetype item with
a why, a priority, a budget band and a status.

Example slot: "Navy unstructured wool overshirt. Why: your best neutral,
layers over tees for 9 months of Wellington weather, the unstructured shoulder
suits a broad frame. Priority 1. Budget $250 to $450. Status: wanted."

Slot statuses: wanted, saved candidate, owned, retired. Slots carry the
colour family, garment type, fabric preferences, fit, and the sizes to look
for, all of which the finder reads. Malin can add, edit, reorder and delete
slots; Claude proposes the first draft and can propose refills when a slot
becomes owned.

## 2. The finder

Nightly CLI (`scripts/find.ts`) with four stages. Stages 1 and 2 are
deterministic and free. Stage 3 costs Claude tokens and only runs on new or
changed products. Stage 4, statement pieces (added 2026-11-05, see the build
sequence), is free rules then Claude, on its own nightly cap.

### 2.1 Ingest

Retailer adapters normalise products into one table: retailer, external id,
title, vendor, product type, tags, description, images, variants (size, colour,
price, compare-at price, availability), URL, first seen, last seen, content
hash.

Shopify storefronts expose `/products.json?limit=250&page=N` publicly, no key.
Probed on 2026-11-04:

| Store | Shopify feed | Wellington store |
|---|---|---|
| Barkers | yes | yes (342 Lambton Quay; also 82 Cuba St) |
| I Love Ugly | yes | yes (3/115 Victoria St; also Old Bank Arcade) |
| Good As Gold | yes | yes (20 Bond St, Te Aro) |
| Country Road NZ | yes | not listed on its own site |
| Workshop | yes | yes (cnr Customhouse Quay and Hunter St) |
| Huffer | yes | yes (60 Cuba St) |
| Crane Brothers | yes | no (Auckland) |
| Checks Downtown | yes | no (Auckland only) |
| Commoners | yes | no (stockists only) |
| Area 51 | yes | yes (49 Dixon St) |
| END. (UK, ships to NZ) | yes | no |
| Patagonia NZ (added 2026-11-05) | yes | not readable (locator drawn by script) |
| Bronze Snake (AU, ships to NZ; added 2026-11-07) | yes | no (Australia only) |
| LSKD (AU, ships to NZ; added 2026-11-07) | yes, whole catalogue only (robots.txt disallows collection feeds); links only | not checked |
| Hallensteins | no (406) | yes |
| Rodd & Gunn (added 2026-11-05) | no (410); links only | yes (46 Willis St) |
| THE ICONIC | no | no |
| Uniqlo AU | no | no |
| Lululemon NZ | no (Cloudflare 403); added by hand | not checked |
| ASOS | no | no |
| Mr Porter | no (403) | no |

One generic Shopify adapter covers the Shopify stores above and any other
Shopify store Malin pastes a URL for. Non-Shopify stores need a per-retailer
adapter each. Rodd & Gunn (Salesforce Commerce Cloud) has one since
2026-11-05, asked for by Malin, for links only (`src/lib/finder/rodd-and-gunn.ts`,
migration 0019): its product pages are allowed by robots.txt and answer the
finder's own User-Agent, and each carries the price, the usual price, the
photos and stock per size. Walking it was built first and dropped: the
catalogue is a page per colour (about 2,540 in the NZ sitemap) and the
paginated grids are disallowed, so a whole read takes most of an hour at a
page a second, and Malin chose pasting links over reading it a slice a
night. A colour's leg lengths (each its own page) are stored as one product,
sizes named with their length.

THE ICONIC, Uniqlo and Hallensteins were researched in M5 and are not read
(THE ICONIC's terms forbid robots, Uniqlo does not sell to NZ, Hallensteins
by Malin's choice; see M5 below). Lululemon NZ (Salesforce Commerce Cloud)
answers everything but robots.txt with a Cloudflare challenge, and its
affiliate feed on Commission Factory needs a public site to promote it from,
so since 2026-11-05 it is a store added by hand (platform `manual`, migration
0012): a Lululemon link pasted on Saved opens fields for its photo, name,
kind, price, colour and size, and the price is never checked. The Wellington stores above were first written from memory and
verified on each retailer's own site on 2026-11-04 (M4); each one's page is
the `source` in `data/retailers.json`.

Ingest is polite: one request per second per host, a real User-Agent that names
the app, and the robots.txt of each store checked once and respected.

### 2.2 Filter

Cheap SQL and rules: menswear only (product type, tags, vendor collections),
in stock in one of Malin's sizes, within the slot's budget band, not previously
dismissed, garment type compatible with at least one wanted slot. This usually
cuts a few thousand products a night to a few hundred candidates.

### 2.3 Score

For each candidate, Claude receives the main product image, the normalised
product data, the style guide, and the compatible slots. It returns structured
JSON: best slot (or none), colour verdict against the palette, fit and
proportion verdict, fabric and quality notes, a 0 to 100 match score, and a
one-sentence why written for Malin. Below a threshold the product is not shown.

Model split: Sonnet for scoring (volume, cheap), the top model for the one-off
profile analysis and blueprint drafting (quality matters, runs rarely). Load
the `claude-api` skill before writing any of this code.

Rough cost shape, planned before M3:

| Run | Products scored | Approximate cost |
|---|---|---|
| First full pass | 3,000 to 5,000 | $15 to $40 |
| Nightly delta | 100 to 400 | under $2 |

Measured in M3 (first real pass, 2026-11-04): see "M3 first pass" under the
build sequence below.

### 2.4 Feed

Grouped by blueprint slot, best match first. Each card: image, retailer,
price in NZD (converted for END. with a note that duty and shipping are extra),
the why, the size that is in stock, and for Wellington retailers a "try on at
<store>" line. Actions: save, dismiss with a one-tap reason (colour, fit,
price, not my thing), mark as bought (fills the slot). Dismiss reasons are
appended to the taste profile so the scorer sees them next run. Saved items
are re-checked nightly for price drops and stock changes.

## 3. Build sequence (review gated)

Each milestone ends with Malin using it and saying it is right before the next
starts. This is how finance-tracker and meal-coverage were built.

**M0 Scaffold.** Repo, Next.js app, Postgres schema in `docs/schema.sql`,
Docker and Coolify config, Basic Auth on the proxy as the agreed single-user
stopgap, Claude SDK wired with a health check. No UI beyond a shell.

**M1 Profile.** Photo upload, Claude analysis, confirm and correct screen,
measurements and sizes, life and taste and budget forms. Gate: Malin reads his
own profile and agrees with it, including the season placement.

**M2 Style guide and blueprint.** Generation, editing, reordering, statuses.
Gate: Malin looks at the 30-odd slots and says these are things he would
actually buy, in roughly that order.

**M3 Finder.** Shopify adapter, nightly job, filter, scorer, feed with save and
dismiss. Run it locally for a week against the eleven stores. Gate: the daily
feed has a hit rate Malin is happy with and the cost per night is known.

M3 built 2026-11-04. Gate pending.

**M3 first pass**, run locally against the eleven stores on 2026-11-04:

| Stage | Count |
|---|---|
| Products ingested (Country Road, Good As Gold, Huffer and END. through their men's collections) | 29,048, with 157,442 variants, in 2.5 minutes |
| Matched: menswear, a wanted slot's garment, in his size, in the slot's band, not dismissed | 5,788 |
| Candidates after the colour rule (3,410 photos read for listings that name no colour) | 2,738 |
| Scored by Sonnet before the Anthropic credit balance ran out | 1,050 |
| Shown (score 70 or more) | 71 |

Claude cost: $7.78 for the 1,050, which is $0.0074 a product (fresh input,
mostly the photo, $2.92; the run's cached context read 1,050 times, $2.55;
output, about 220 tokens a verdict, $2.27). 10.8 minutes at six in flight.
The rest are scored on the next run once the balance is topped up.

The 71 are mostly buy-first slots: dark ink denim 31 (best 88), putty chinos
19 (82), suede Chelsea boots 5 (86), ecru leather sneakers 5 (82), espresso
chinos 5 (86), the wool overshirt 2, corduroys 2, the ecru tee and the rain
shell 1 each, from Barkers 23, Country Road 18, END. 15, Area 51 8, I Love
Ugly 4 and Workshop 3. Scoring runs in slot order, so the knitwear, shirts and
later slots had not been reached when the credit ran out.

Sport kit (running shoes, golf polos, gym tees) went to activewear, which no
slot asks for, after a five-product trial and before the pass; it took the
matches from 6,056 to 5,788. What the pass's verdicts taught, now in the rules
for the next run: Sonnet threw out stark white tees offered to the ecru slot
(a photo read with no warmth in it is now white, not ecru), and cuts the
listing itself calls boxy, oversized or relaxed where the slot and the guide
do not allow them. Re-filtering with those rules (same products, no scoring) gave 2,395
candidates instead of 2,738, and 62 of the 71 shown still pass. 1,560 of the
2,395 have no score yet: about $11.50 at $0.0074, so the whole first pass
comes to about $19.30, at the low end of the $15 to $40 planned.

Nightly cost: an ingest an hour after the first found 0 new, 8 changed and 0
removed products, so a night's scoring is the stores' new arrivals that pass
the filter, an estimated 20 to 60 products, $0.15 to $0.45 a night. That is
an estimate until a week of nightly runs gives the real figure, which is the
gate.

His waist and shoe size are not on the profile yet, so trousers, jeans and
shoes show every size in stock (and say so) until he adds them.

**M3.5 Try-on.** "See it on me" on a feed item: the product's own image and
one of Malin's full-length photos go to an image-generation provider, which
returns him wearing that product. It comes after the finder because a try-on
is only worth deciding a purchase on when it shows a real product in his size;
a picture of an archetype slot would be the model inventing the garment.
Claude cannot generate images, so this adds a second provider. Step one is
choosing it, before any code: try-on quality on menswear (fit, drape, colour
held true to the product photo, since colour is the point of the app), and its
data terms (retention, training on inputs, deletion). Malin agrees the provider
and the change to the photo rule in section 1.1 first. Then: generated on
request only, never in bulk; cached with the photos with a row per image
(product, source photo, provider, cost); deleted along with his photos by the
existing "delete photos" action; cost per image recorded like the finder's.
Gate: Malin tries on a week of feed picks and finds the images honest enough to
change what he buys.

Provider chosen 2026-11-04: OpenAI, `gpt-image-2.5-sunburst` (its model for
"workflows where editing precision matters most") at high quality, his
photo's own 3:4 aspect, through the Images edit endpoint with plain `fetch`
(no SDK). Researched against the providers' own docs, pricing and terms:

| Option | Why not, or why |
|---|---|
| OpenAI gpt-image | Chosen by Malin. No training on API data; 30-day abuse-monitoring retention, zero retention only by sales approval; priced by tokens ($8 per million image input, $30 per million output), so the cost of each image is recorded from the usage it reports |
| FASHN Try-On Max | Recommended in the research (purpose-built, keeps no image after the request), not chosen; its model providers include OpenAI, fal and BytePlus |
| Gemini 3 Pro Image | General editor, $0.134 an image, abuse logs of unstated length "in any country" on the Gemini API |
| Google virtual-try-on-001 | Deprecated 2026-09-14, retires 2027-03-15 |
| Kling Virtual Try-On | 30-day logs in Singapore; takes only public URLs, so his photo would have to be public |
| Black Forest Labs | Its API terms license inputs and outputs for training |
| fal, Replicate | Resellers: one more company holding the photo; fal keeps inputs and outputs 90 days by default |

M3.5 built 2026-11-04. "See it on me" sits on each find card on Today. The tap
records a request (`src/lib/try-on.ts`, table `try_ons`, migration 0005) and
the image is made after the response, so leaving the page loses nothing; the
card polls `/photos/try-ons/:id/status` and, once ready, opens a viewer with
him in it beside the shop's photo. One image is in the making at a time (a
unique index). The prompt asks for him unchanged, the garment exactly as sold
(colour first) and no flattery. Images are served only through
`/photos/try-ons/:id`. Cost per image is on /you/finder.

First real try-on, 2026-11-04 (The North Face Antora Jacket from Area 51, on
his beach full-length photo): 34 seconds; 267 text and 2,973 image tokens in,
1,629 image tokens out at high quality, 1152x1536, so US$0.074 an image. Face,
build, pose, shorts and background held; the navy panel averaged #161f3e on
the shop's photo and #1f2942 on him, the same hue a little lighter in midday
sun. He is small in that photo, so detail such as the chest logo is hard to
judge; a plain-background full-length photo in fitted clothes would give the
model more of him to work with.

A look can be tried on too (2026-11-04, migration 0008): "See it on me" on
each look card dresses him in the whole outfit. The pieces go in the look's
order, outermost first, each shown by his own photo of it, else the shop's
photo, else described in words (name, colour, cloth and fit), and the prompt
says which is which. A try-on row is now of a find or of a look, never both;
it keeps how each piece was sent. A look with a piece gone from the wardrobe
cannot be tried on. The viewer shows him beside the pieces' photos.

A find's cut is said in words (2026-11-07, migration 0021, after Bronze
Snake's Phillip overshirt, plainly oversized in the shop's photo, came back a
regular fit on him). Left to the photo, the editor fits every garment close
to his body, and "keep his build" pulled the same way. So before a try-on
with a find is made, Sonnet reads the shop's photo (by URL, as the nightly
scorer does) and the listing once and says the cut in positions: where the
shoulder seams sit, the room in the body and sleeves, where it ends
(`src/lib/garment-cut.ts`, kept in `product_cuts` per product and photo).
The prompt carries that line, his build is said to be his body and not the
clothes, and every piece is to keep its own cut, never taken in to his shape.
His own photo of a find is never read, and shoes, belts, bags and
accessories have no cut to read. A read takes about 3 s and US$0.0075, once
per find; it is Anthropic spend, so it is not in the try-on figures on
/you/finder, which are OpenAI's. First reads: the Phillip overshirt
oversized, a Country Road tee whose listing says relaxed, relaxed.

**M4 Deploy and polish.** Coolify deployment, scheduled task, PWA manifest and
icons, price-drop and restock tracking on saved items, verified Wellington
store addresses, loading and empty states that are actually good.

M4 built 2026-11-04. Gate pending: the app running on Coolify, the finder
nightly there, and Malin using it from his phone.

- GitHub `malinmalliyawadu/wardrobe` (public, Malin's choice), CI on every
  push and pull request: typecheck, lint, migrations, tests, build, and the
  Docker image.
- Sign-in: a password screen with a year-long signed cookie in place of Basic
  Auth, chosen by Malin because an installed iPhone web app handles a Basic
  Auth prompt badly. One secret, `APP_PASSWORD`; changing it signs every
  device out.
- Coolify: the README's click-through. The image builds with the network off,
  migrates and seeds the shop list on boot, keeps photos on a named volume at
  `/data` (in an R2 bucket since 2026-11-07), and is health-checked on the database alone so a Claude outage
  cannot take it down. The finder is a scheduled task with a one-hour timeout.
- PWA: manifest and icons (the palette strip in his colours on pine, since the 2026-11-05 redesign; the Today swatch fan before),
  no service worker.
- Saved finds: price drops, sell-outs and restocks in his size, replayed from
  `price_observations`; the night's news is a line on the find and a summary
  under Saved.
- Wellington stores verified on the retailers' own sites (table above): six
  shown as "try on at", Country Road left unverified, Checks Downtown and
  Commoners have none of their own.
- Loading states are skeletons in the shape of what streams in, held back
  300 ms; the empty states each say what comes first and offer the button.

**M5 Reach.** Per-retailer adapters for THE ICONIC, Uniqlo and Hallensteins,
on-demand searches ("a navy overshirt under $300") that run the pipeline
immediately, optional wardrobe inventory and outfit suggestions from owned
items. (The adapters were researched and, on Malin's call, not built; see
below.)

**M5 Wardrobe and looks**, agreed with Malin and built 2026-11-04, ahead of
the rest of M5. A Looks tab between Today and Blueprint, with two pages:

- Pieces: what he owns, shelved by garment, with how much is in his palette.
  A piece comes in by photo (on the phone the tile opens the camera; "Save
  and add another" goes round the wardrobe one piece at a time), by a shop
  link, typed in, or on its own when a slot is marked owned or a find is
  bought. A piece records garment, colour (a guide hex where it fits), the
  colour in words, fabric, fit, warmth, brand, size, notes, a photo and the
  slot it fills. A slot is owned exactly when a piece fills it. Worn out or
  given away is "set aside", not deleted.
- Looks: Opus makes six outfits on his tap from the pieces' words, against
  the guide, his proportions, his week and Wellington's usual weather for the
  month, with an optional note ("a cold, wet week"). Each look shows the
  pieces laid out, the occasion and weather, a two-sentence why (the colour
  story and the proportion rule it uses), one styling note, and sometimes
  "even better with" one wanted slot. Save, dismiss with a reason, and "Wore
  it today"; the next set reads all three. Code drops any look that is not a
  whole outfit from pieces he has.

Measured 2026-11-04: a photo read by Sonnet took 6 s and cost US$0.010. Four
sets of looks, on a copy of his data with 17 pieces (13 slots marked owned,
his three owned pieces and a bought Chelsea boot), took 46 to 99 s and cost
US$0.15 to 0.32 each (10.6k to 11k tokens in, 5k to 8k out); every proposed
look passed the checks. Gate: Malin adds what he owns, photographing it, and
agrees he would wear the looks.

**M5 Reach: the three stores, researched 2026-11-04** before any code, each
read with the finder's own User-Agent and, for the terms, on the store's own
site:

| Store | How its catalogue could be read | robots.txt | Terms on automated access | Currency | Verdict |
|---|---|---|---|---|---|
| THE ICONIC (NZ) | Not examined past robots.txt and the terms, which rule out reading it | Allows `/`, disallows `/bff/`, `/assets/`, `/images/` | General Terms 1.2(b), last updated 9 July 2026: you must not "use data mining, robots, screen scraping or similar data gathering and extraction tools on the Site, unless expressly authorised by THE ICONIC" | NZD | Doubtful: barred by its terms, and its API by robots.txt. The authorised route is its affiliate programme (Partnerize), which offers a product feed |
| Uniqlo (AU) | Not examined: uniqlo.com/au answers the finder's User-Agent with 403, and that is not worked around | Allows product pages, disallows search, cart and filter parameters | Not read, for the same reason | AUD | Not buyable: Uniqlo has no NZ store and its Australian shop "only deliver[s] to addresses within Australia" (its own FAQ). No uniqlo.com/nz exists (404) |
| Hallensteins | Every category page carries its products as data (`window.category`: title, style, department, category, each colour with its images and every size's price and stock state), 24 a page by `?p=N`; a product page (`window.product`) adds the description and stock counts for every colour of the style. The sitemap lists 1,260 colour pages of 776 styles | Allows everything but account, cart, checkout and the `?f=`, `?s=` and `?q=` search and filter parameters | Terms of use: use is "personal to you"; you may not use its material "for public or commercial purposes"; nothing on robots. One clause opens "Other than connecting to Hallensteins' servers by HTTP requests using a web browser", about gaining access by admin passwords or masquerading | NZD | Readable for a personal, non-commercial finder; about 60 category pages a night (clothing, accessories, suits) |

Sources: [THE ICONIC terms](https://www.theiconic.co.nz/terms-conditions/),
[THE ICONIC robots.txt](https://www.theiconic.co.nz/robots.txt),
[THE ICONIC affiliate programme](https://uppromote.com/affiliate-program-directory/the-iconic)
(third-party summary: Partnerize, product feed for approved affiliates),
[Uniqlo AU "Do you deliver to New Zealand?"](https://faq-au.uniqlo.com/articles/en_US/FAQ/Do-you-deliver-to-New-Zealand),
[Uniqlo robots.txt](https://www.uniqlo.com/robots.txt),
[Hallensteins terms of use](https://www.hallensteins.com/l/terms-conditions),
[Hallensteins robots.txt](https://www.hallensteins.com/robots.txt),
[Hallensteins sitemap](https://www.hallensteins.com/content/sitemaps/sitemap.xml).

Hallensteins' Wellington stores, on its own store finder: Lambton Quay
(Level 2, 312 Lambton Quay) and Cuba Mall (corner of Cuba and Dixon Streets),
plus Queensgate (Lower Hutt) and North City (Porirua).

Decided by Malin on 2026-11-04: none of the three is built. THE ICONIC and
Uniqlo are out for the reasons above, and Hallensteins is left out too, so
the finder stays on the eleven Shopify stores. A store can still be added by
pasting its Shopify URL into `data/retailers.json`.

**M5 on-demand search**, agreed with Malin and built 2026-11-04 (migration
0010). A Search tab between Today and Looks, chosen over a field on Today.
He types what he wants ("a navy overshirt under $300"); the search page shows
its progress and then its finds, refreshing itself until it is done, so he
can leave while it runs.

- Sonnet reads the request into the filter's terms: garment, colours (and
  their neighbours), price, a cut if he named one, and a few words to rank by.
  A request that is not menswear, or too vague, fails with Sonnet's own
  sentence saying why.
- The nightly filter runs with the request as its one target, over what the
  last nightly run read: his size from the profile, the price, not plainly the
  wrong colour or cut, not dismissed or bought. What he has saved is left out,
  so it is not paid for twice. No photos are read during a search.
- Sonnet judges the candidates closest to his words first, with the request as
  the only slot, against his profile and guide, until the search's limit
  (US$0.50 by default, set on /you/finder; it counts toward the monthly cap
  with the nightly runs). Where his words and his guide disagree, the request
  decides and the verdict says how it sits with the guide, scored under 75.
- What the page will show (score 70 or more, at most 12; with none, the
  closest three at 50 or more) is re-read from its shop for today's price and
  stock in his size before it is shown.
- No blueprint slot is made. Results save without a slot, like a pasted link,
  and land in Saved on Today; dismissals teach the nightly scorer too. "Add to
  blueprint" opens a new slot already filled from the search (name, garment,
  colour words and the palette swatch they name, fabrics, cut, price band).

First real search, 2026-11-04, on his local copy (11 stores, 27,822 menswear
pieces): "a navy overshirt under $300" matched 107 in his size, 51 after the
colour and cut rules, and all 51 were judged; 7 cleared the bar (best 88,
Barkers' Renton Overshirt in navy flannel) and all 7 were still in stock on
the re-check. 40 seconds. US$0.33: US$0.005 to read the request and
US$0.0063 a product judged (68k fresh input tokens, 10.5k output, 322k read
from the cached context).

Found on the way and fixed: a nightly run that reached its spend cap
recorded `skipped_for_budget` as 0, because each of the six scoring workers
overwrote the count the first had set; Today then said judging "stopped"
rather than that it stopped at the limit.

Gate: Malin uses Search for a week and agrees its finds are ones he would
buy, at a cost per search he is happy with.

**Outfit of the day**, asked for by Malin and built 2026-11-05 (migration
0012). Today, between the hero and the finds, dresses him for the day from
what he owns:

- The first opening of Today on a day starts it (after 6pm it dresses him for
  tomorrow, to lay out the night before). Opus gets the day's Wellington
  forecast for the hours he is out, 7am to 10pm (Open-Meteo, free and keyless;
  the request carries only the city's coordinates), the New Zealand season,
  the weekday against his week, his profile and guide, his pieces with how
  often each was worn lately, the looks he saved and dismissed, and what he
  wore this week. With no forecast it dresses him for the month's usual
  weather and says so.
- Three options, best first, each held to what a look must be (tidyLooks);
  one he wore this past week or dismissed is dropped. Each option is a look,
  so Save and "Wear this" are the looks' own, and wearing one saves it. An
  option that is piece for piece a look already made (saved, or offered
  before on another day or in a set, and not dismissed) is that look, not a
  copy, so its picture is kept rather than drawn again.
  "Another" turns to the next. "Something on today?" makes a new three with
  his note ("dinner out tonight").
- The option on show gets a picture: a flat lay drawn by OpenAI from photos
  of his clothes (photo rule above), with the pieces themselves in a row under
  it to judge the colours against. "See it on me" puts him in it, on his tap.
- One outfit, one look, its pictures made once (Malin's ask, 2026-11-05,
  migration 0016). A set on the Looks tab and a remade look offer the look
  already made with the same pieces too. A flat lay or a picture of him belongs to the pieces,
  not to the look or tap that asked for it: a look with the same pieces as
  another, pieces chosen on the On me page that make up a look, or a find
  chosen alone, show the kept picture, and the chooser opens it instead of
  making one. "Make it again" is the only way to pay for a second.

First real run, 2026-11-05, on a copy of his data with ten pieces (two linked
to shop products): the outfit in 23 s for US$0.09 (11.3k tokens in, 2.1k
out), all three options kept; the pictures in 25 to 27 s for US$0.05 to
0.08. A day costs about US$0.14, plus US$0.05 to 0.08 for each other option
he opens.

Gate: Malin uses it for a week and wears what it suggests on most days.

**Statement pieces**, asked for by Malin and built 2026-11-05 (migration
0017). The blueprint's slots are mostly the right basics; he wanted a way to
find the pieces that carry an outfit. He chose what a statement is for him
(a bold colour, a texture, or a cut or detail, not a pattern) and a shelf
Claude picks over a free filter on Shops.

- A fourth stage of the nightly run. Free rules over everything read, in his
  size, under the most he would pay for one of its kind (his budget on the
  profile, else the blueprint's top band for the garment), not dismissed or
  bought: one of his best colours that is not a neutral, a texture word in
  the title or tags (cord, boucle, mohair, suede, leather, shearling,
  velvet, moleskin, waffle, terry, crochet...), or a cut or detail in the
  title (camp or Cuban collar, boxy, cropped, double-breasted, shawl, balloon
  or barrel leg, western...). Not tees, shorts, gym kit, caps or bags; a shoe
  only by colour or cut, since every loafer is leather or suede.
- Sonnet judges each new or changed one, two signals first, against his
  profile, his guide and his everyday pieces: what makes it a statement, a 0
  to 100 for him (a pattern or a logo is under 40), the colour on offer that
  suits him, one line on how to wear it, and up to three of his pieces it
  wears with. Its own nightly cap, US$0.50 by default, inside the month's.
- `/statements` shows the latest run's shortlist over 70, best first,
  filtered by colour, texture or cut; Finds carries a row of the best five
  under the search line. Save, dismiss and bought are the feed's.

First real run, 2026-11-05, over the catalogue read the night before: 825
picked from the 4,070 pieces in his size and budget (537 by colour, 183 by
texture, 150 by cut), 100 judged in 46 s for US$0.53, 21 over the bar. The
first pass through the rest is about US$4 more, eight nights at the
default cap; after that only new pieces cost anything.

Gate: Malin uses it for a week and agrees the shelf holds pieces he would buy,
at a nightly cost he is happy with.

## 4. Design direction

Redesigned on 2026-11-05: see `docs/design.md`. The paragraph below is the
intent as it stood at M0.

Decide properly at M1 with the frontend-design and ui-ux-pro-max skills loaded,
but the intent is set: editorial rather than dashboard. Think a well-set
menswear lookbook. Large product imagery with room around it, a serif display
face with a quiet grotesque for data, no gradients, hairline rules. The one
place colour is load-bearing is the palette itself: Malin's best colours become
the app's accent swatches, so the interface literally wears his palette. Dark
and light both first class since the feed is read on a phone at night.

## 5. Open questions for Malin

None block M0.

1. App name.
2. Budget ceilings per category and overall per month.
3. Any Wellington or NZ stores to add beyond the eleven (anything on Shopify
   is a URL paste away).
4. Whether photos may be kept after the profile is confirmed, or should be
   deleted automatically.
5. Do we want a Claude-written weekly "state of the wardrobe" note in the app,
   or is the feed enough.
6. ~~Which try-on provider for M3.5.~~ OpenAI, agreed 2026-11-04 with the
   photo rule in 1.1.
