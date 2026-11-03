# Handoff prompts

Prompts for starting a fresh session on this repo, in the order the plan runs.
Each one is self-contained: it tells the session what to read first, what to
build, what done looks like, and the gate at the end. Paste one per session.

Every prompt assumes the session is started in `~/Projects/wardrobe`.

---

## 1. Pass the M1 gate on real photos

```
Read CLAUDE.md, docs/plan.md and docs/handoff-prompts.md first. Load the
claude-api skill before touching anything under src/lib/analysis.ts.

I have set ANTHROPIC_API_KEY in .env and I am about to upload my own photos on
/you/photos and run "Read my colouring". Help me pass the M1 gate:

1. Start the dev server with the "wardrobe" launch config and confirm
   /api/health shows Claude reachable.
2. After I run the read, open /you/colouring with me and critique the result
   as a stylist would: does each "why" name something real in the photos, are
   the confidences honest, does the season placement hold up against the
   runner-up, are the photo_notes caveats correct?
3. Where the read is weak, improve SYSTEM_PROMPT in src/lib/analysis.ts and
   rerun. Keep the schema the same. Do not lower effort or change the model.
4. Record what you changed and why in CLAUDE.md under Milestones.

Done means I have confirmed a profile I agree with, including the season, and
Today shows my palette. Do not start M2.
```

## 2. M2: style guide and blueprint

```
Read CLAUDE.md, docs/plan.md (sections 1.2, 1.3 and M2) and docs/schema.md
first. Load the claude-api skill before writing any Claude call, and load the
frontend-design, ui-ux-pro-max, animate, emil-design-eng and mobile-native
skills before any UI. Follow the design rules in CLAUDE.md exactly: flannel
and chalk tokens, Newsreader and Hanken Grotesk, brass as the only accent, no
colour gradients, no new page-load animations.

Build M2, the style guide and blueprint, on top of the confirmed profile:

1. Style guide generation (src/lib/style-guide.ts): one Opus call at high
   effort with a zod structured output, same shape as src/lib/analysis.ts.
   Input is the whole profile (colouring, proportions, sizes, fit preferences,
   life, taste, budget) plus the season table in src/lib/seasons.ts. Output is
   the structured guide the style_guide table expects: palette (best colours
   as hex with names, best neutrals, colours to avoid, metal), silhouette and
   proportion rules written for my height and build, shoe guidance,
   accessories guidance, and a fit vocabulary per garment type. Include
   server-side fallback and refusal handling as analysis.ts does.
2. Blueprint drafting (src/lib/blueprint.ts): a second Opus call that takes
   the profile and the guide and returns 30 to 40 slots matching the
   blueprint_slots columns: name, why (one sentence to me), priority 1 to 3,
   garment type, colour family, colours, fabrics, fit, sizes to look for,
   budget band inside my category ceilings, and position. Owned staples from
   taste.owned must become slots with status "owned" rather than new wants.
3. UI. The Blueprint tab becomes the real thing: slots grouped by priority,
   each a card with the why, colours as small swatches, the budget band and
   status. I can edit any field, reorder within a priority, change status
   (wanted, candidate, owned, retired), delete a slot, add my own (source
   "malin"), and ask Claude to redraft the whole blueprint or refill one
   retired slot. A "Style guide" page under /blueprint/guide shows the palette
   as swatches and the rules as short sections, editable. Today's swatch fan
   should use the guide's best colours instead of the season table once a
   guide exists.
4. Server Actions follow the pattern in src/app/you/actions.ts, including
   echoing values on validation errors. Tests for the schemas and parsers,
   and a migration if the schema needs anything the first cut lacks (never
   edit an applied migration).
5. Verify in the browser at phone and laptop width in both colour schemes,
   run typecheck, lint, tests and build, and commit.

Done means I look at the slots and say these are things I would actually buy,
in roughly that order. Stop there and ask me.
```

## 3. M3: the finder

```
Read CLAUDE.md, docs/plan.md (section 2 and M3) and docs/schema.md first. Load
the claude-api skill before writing the scorer.

Build M3, the nightly finder, as a CLI at scripts/find.ts that runs inside the
app image as a Coolify scheduled task, plus the feed on the Today tab.

1. Retailers. A data file data/retailers.json with the eleven Shopify stores
   listed in docs/plan.md (Barkers, I Love Ugly, Good As Gold, Country Road
   NZ, Workshop, Huffer, Crane Brothers, Checks Downtown, Commoners, Area 51,
   END.) and a seed script scripts/seed-retailers.ts. Wellington store
   addresses stay unverified (verified: false) until checked against each
   store's own site; do not invent them.
2. Ingest. One generic Shopify adapter over /products.json?limit=250&page=N,
   polite: one request a second per host, a User-Agent naming the app,
   robots.txt read once per retailer and respected. Normalise into products,
   product_variants and price_observations per docs/schema.md, with the
   content hash deciding what changed. Mark products no longer in the feed
   with removed_at.
3. Filter. SQL and rules only: menswear (product type, tags, collections),
   in stock in one of my sizes from profile.sizes, inside the matching slot's
   budget band, not dismissed, garment type compatible with a wanted slot.
4. Score. Sonnet (MODELS.scoring) per candidate with the main image, the
   normalised product, the style guide and the compatible slots, returning
   the product_scores shape via zod structured output. Only new or changed
   content hashes are scored. Record tokens and cost in finder_runs.stats.
5. Feed. Today shows the latest run's matches grouped by slot, best first:
   image, retailer, NZD price (converted for END. with a note that duty and
   shipping are extra), the why, the size in stock, and "try on at" for
   verified Wellington stores. Actions: save, dismiss with a one-tap reason,
   mark as bought (fills the slot). Saved items are re-checked each run for
   price drops.
6. Run it locally against the eleven stores for real. Report the first-pass
   product count, candidates, scored count and Claude cost in docs/plan.md.
   Tests for the adapter's normalisation (against a saved fixture page), the
   filter and the scorer's schema. Typecheck, lint, tests, build, commit.

Done means a week of daily feed I am happy with and a known cost per night.
```

## 4. M4: deploy and polish

```
Read CLAUDE.md and docs/plan.md (M4) first. Also read
~/Projects/finance-tracker/Dockerfile and its .github/workflows/ci.yml for how
my other Coolify app is deployed; this repo follows the same shape.

Deploy Wardrobe to Coolify and finish the polish:

1. Create a private GitHub repo malinmalliyawadu/wardrobe, push main, confirm
   CI passes.
2. Coolify: the app from the Dockerfile, a Postgres 17 service on the same
   private network, a volume at /data, DATABASE_URL and ANTHROPIC_API_KEY as
   secrets, Basic Auth on the proxy as the agreed single-user stopgap (do not
   add in-app auth), and a nightly scheduled task running
   `node scripts/find.ts` inside the image. Raise the proxy's request
   timeout so the photo read's Server Action is not cut off; if that cannot be
   guaranteed, turn the read into a background job with a status row and a
   polling UI instead.
3. PWA: manifest, icons, theme colours matching the tokens, installable on
   iOS. Keep the design rules in CLAUDE.md.
4. Loading and empty states for every page that are actually good, not
   placeholders. Review on a real phone over the LAN, not only emulation.
5. Verify the eleven Wellington store addresses against the retailers' own
   pages and set verified: true only where confirmed.

Done means the app is reachable on my phone at its real URL, the nightly task
has run once on the server, and the health check is green including Claude.
```

## 5. Small, any time

```
Read CLAUDE.md first. In ~/Projects/wardrobe, make the photo read resilient to
a slow proxy: run analysePhotos in a background job recorded in a new
analysis_runs table (migration), start it from the Server Action, and poll
its status from /you/photos with a quiet progress state that follows the
motion rules in CLAUDE.md. Keep the result identical to today's. Tests for
the job's state machine. Typecheck, lint, tests, build, commit.
```
