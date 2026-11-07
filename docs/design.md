# Design

Wardrobe is a lookbook for one man, read on a phone in the morning (what to
wear) and at night (what was found). Every screen opens on the thing itself,
a picture or a list of real things, and the words come after. Nothing on a
screen is there to explain the screen.

Redesigned 2026-11-05. Tokens and primitives live in `src/app/globals.css`;
this file is the reasoning, so a new page can be built without reading every
other page.

## Information architecture

Six tabs, ordered by how often each is opened:

| Tab | Route | What it is |
|---|---|---|
| Today | `/` | The outfit of the day, and nothing else. Three options to swipe between, a gym fit on gym days, "something on today" at the end. Until there is a guide and a wardrobe, it says what to do next. |
| Finds | `/finds` | The shopping tab. A line to ask the shops for something (which runs a Search, `/search`), a row of the best statement pieces leading to `/statements`, last night's finds by slot, and the way into everything the finder read (`/shops`). |
| Wishlist | `/wishlist` | What he wants: every find he saved and every link he pasted, each with what changed since. He opens it in a shop to decide whether to buy, so it is a tab of its own, with the paste-a-link line first. |
| Wardrobe | `/wardrobe` | What he owns (the index), with Looks (`/wardrobe/looks`), On me (`/wardrobe/on-me`) and Worn (`/wardrobe/worn`, what to rotate out and what he passes over) as sections under its name. A piece is `/wardrobe/[id]`, adding one is `/wardrobe/new`. |
| Blueprint | `/blueprint` | What to own, by priority, with the style guide (`/blueprint/guide`) at the top wearing its palette. |
| You | `/you` | The profile, the finder's spend and shops, the systems. Edited rarely. |

Old `/looks/*` paths redirect (see `next.config.ts`).

## Material

- **Ground**: uncoated stock by day (`--ground` #f1f0ec), pine black by night
  (#141b18, the dark neutral of a deep autumn, not a tinted grey). Both first
  class; the night one is what the feed is read on.
- **Sweep** (`--photo`, white in both schemes): every product and piece photo
  sits on it, the photo multiplied in, so a shop's white background becomes
  the tile. It stays light at night on purpose: the garment's colour is what
  he is judging.
- **Ink**: the type, and the one solid button on a screen (`.btn-primary`),
  like a woven label. Primary buttons are never coloured.
- **Accent**: bottle green (`--accent`), the only interface colour. It marks
  the active thing: the open tab's dot, a link that acts (`.text-button`), a
  saved mark, a focus ring, good news on a saved find. Never a fill.
- **His palette**: every other colour on screen is Malin's own, from the
  guide, shown as flat swatches (`.swatch`, the `Swatch` component): the
  strip beside the wordmark, a slot's colours, a piece's colour. Flat chips
  with a hairline edge, no texture, no fan.
- **Alert** (`--alert`) is for errors and a hold-to-delete fill only.

No gradients. No shadows except the viewer's scrim. No glass except the tab
bar, which the page scrolls under.

## Type

One family, Instrument Sans (variable: weight 400 to 700, width 75 to 100,
italic), committed under `src/fonts`. Two voices from one face:

| Class | Use | Setting |
|---|---|---|
| `.display` | The cover line: the look's name under its picture, a page's name | width 75, weight 650, -0.022em, line-height 0.94 |
| `.headline` | A section's name, a card's name | width 82, weight 620, -0.015em, line-height 1 |
| `.title` | A row's name, a slot's name | width 90, weight 600, -0.012em, line-height 1.1 |
| body | Everything read | width 100, weight 400, 16 to 17px, line-height 1.5 |
| `.caption` | A small line naming what follows, counts, dates | 13px, weight 500, ink-3, sentence case |

Sizes: display 2.5rem on the phone and 3.25rem up; headline 1.5rem; title
1.125rem. Italic is for the stylist's one styling line on a look. Numbers
that line up (prices, counts) are `tabular-nums`.

Never: tracked uppercase labels, a label above every block, one word of a
headline in another colour or weight, middle dots between facts (use a comma
or a new line), an arrow glued to link text.

## Layout

Malin reads this mostly on a laptop, so the laptop layout is the primary one
and the phone is the same content in one column, not the other way round.

- Gutter `--gutter`: 1.25rem on the phone, 3rem on the laptop. `.bleed` runs
  a picture or a `.scroller` row out through it to the screen's edge on the
  phone; on the laptop it does nothing (`lg:mx-0` where a bleed is used).
- On the laptop (`lg`, 1024px and up) a 15rem rail holds the wordmark, the
  palette strip and the tabs; the content column beside it is `max-w-[76rem]`.
  Every page uses that width as a spread, not as a wide single column:
  - Today: two columns, the cover picture (up to 30rem) on the left, the
    words and actions on the right, the other options as thumbnails under
    them.
  - Finds: the heading line across the top, then each slot's finds as a grid
    of 4 cards (3 at `lg`, 4 at `xl`).
  - Wishlist: the paste-a-link form (`max-w-2xl`), then the rows in two columns.
  - Wardrobe: pieces 4 across at `lg`, 5 at `xl`; looks 3 across; pictures
    4 across; Worn as rows two across at `lg`, each a picture (a strip of a
    look's pieces, stacked above the words on the phone) beside its name, how
    often it was offered and worn, and the one way to discard it.
  - Blueprint: `lg:grid-cols-[18rem_minmax(0,1fr)]`: the palette band, the
    overview line and "Add your own" in a sticky left column, the priority
    groups on the right with rows no wider than `max-w-3xl`.
  - You: the hub rows on the left and Systems on the right, two columns.
  - A sub-page with a form: the form `max-w-2xl`; never a field wider than
    that. Paired fields sit side by side (`sm:grid-cols-2`).
  - Shops: the search and its filters in one row, the grid 4 across at `lg`,
    5 at `xl`.
  - Statement pieces: the title and its line, colour, texture and cut as a
    sub-nav with counts, then the find cards in a grid, 1 across on the
    phone, 2 at `sm`, 3 at `lg`, 4 at `xl`. A card says what makes it a
    statement where a find says its match, and shows the pieces of his it
    wears with as small pictures, each a tap to the piece.
- The phone column is the screen: one column, the same order.
- A page opens with its first real thing. A page's name is small (`.caption`
  or a `.headline`) unless the name is the content (Blueprint's "34 slots").
  The explanatory paragraph under a page title is gone; a line of help sits
  where it is needed, under the control it helps.
- Sections are separated by space, 3rem and up, with a `.caption` naming the
  section and, at the right, its count or date. Hairlines (`border-line`)
  divide rows inside a list, never sections.
- Corners: 0 on anything that bleeds, `--radius-tile` (4px) on photo tiles
  and swatches, `--radius-control` (6px) on buttons, fields, chips and
  segments. No pills.
- Images: product photos 4:5 on the sweep, `object-contain`; pieces 3:4;
  the outfit's picture 4:5. Tiles in a grid are 2 across on the phone, 3 on
  the laptop; a `.scroller` row is 72vw a card on the phone and a grid on
  the laptop.
- Touch targets 44px and up. The tab bar and any sticky action bar pad for
  `env(safe-area-inset-bottom)`.
- Left aligned throughout. Nothing is centred except the sign-in page.

## Components (src/components)

- `Shell` pieces in `nav.tsx`: `Wordmark`, `PaletteStrip` (his five best
  colours beside the wordmark; blank calico chips until there is a guide),
  `Nav` (phone tab bar, laptop rail).
- `SectionHead` in `section.tsx`: the caption-and-aside line a section opens with.
- `ButtonLink`, `SubmitButton`: `.btn .btn-primary` or `.btn .btn-quiet`;
  `.btn-small` for a row of them. One primary per screen.
- `Swatch`, `SlotSwatches` in `cloth.tsx`: a colour, and a slot's two or
  three colours stacked as chips.
- `PieceImage`, `ProductPhoto`: a picture on the sweep.
- `Field`, `TextInput`, `NumberInput`, `Select`, `TextArea`, `FormMessage`
  in `form.tsx`.
- `HubRow`: a row in a list that leads somewhere (You, Recent searches).
- `BackLink`: the small way back at the top of a sub-page.
- Skeletons in `skeleton.tsx`: shapes in `--surface`, held back 300ms.

## Motion

From the animate skill: transform and opacity only; `--ease-out` for
entrances; UI transitions under 300ms; press feedback is `.pressable` or
`.btn` (scale 0.97 at 160ms); every animation has a reduced-motion variant.
No entrance animations on page load at all: the picture is the arrival.
Motion only answers a tap: a crossfade when content swaps in place (`.tray`),
a card leaving after an action (`.find`), the viewer opening (`.viewer`), a
tile arriving after an upload (`.tile-enter`). Swiping between the day's
options and through a row of finds is native scroll snap, so the browser's
own physics carry it.

## Copy

Sentence case. Plain verbs. A button says what happens: "Wear this", "Save",
"Add a piece". An empty state says what to do, not how it feels. Errors say
what went wrong and what to do. Plain dash, never an em dash.
