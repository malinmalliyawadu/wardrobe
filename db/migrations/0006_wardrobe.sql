-- M5: the wardrobe. The pieces Malin actually owns, as opposed to the
-- blueprint's slots, which are what he should own. A piece may fill one slot
-- and a slot is filled by at most one piece that is still in the wardrobe.
--
-- Photos of his clothes are files on the photos volume (PHOTOS_DIR/wardrobe),
-- like his own photos, never bytea. A photo row exists before its piece does:
-- the add form reads the photo first and he confirms what was read, so a
-- photo nobody saved a piece for is cleared after a day.

create table wardrobe_photos (
  id          bigint generated always as identity primary key,
  -- Relative to PHOTOS_DIR. The thumb sits next to it as .thumb.jpg.
  path        text not null unique,
  bytes       integer not null check (bytes > 0),
  width       integer not null,
  height      integer not null,
  sha256      text not null,
  -- The colour read on our own server (src/lib/finder/photo-colour.ts).
  colour_read jsonb,
  -- Claude's read of the photo, as it answered, with its model and tokens,
  -- kept so his corrections can be compared with what the model saw.
  read        jsonb,
  read_usd    numeric(10, 6),
  created_at  timestamptz not null default now()
);

create table wardrobe_pieces (
  id           bigint generated always as identity primary key,
  name         text not null check (length(name) between 1 and 120),
  garment_type text not null check (garment_type in (
                 'tee', 'polo', 'shirt', 'overshirt', 'knitwear', 'sweatshirt',
                 'trousers', 'jeans', 'shorts', 'tailoring', 'jacket', 'coat',
                 'activewear', 'shoes', 'boots', 'sneakers', 'accessory', 'bag')),
  -- A guide palette hex where the piece is that colour, otherwise its own.
  colour_hex   text check (colour_hex ~ '^#[0-9a-f]{6}$'),
  -- The colour in plain words: "ink navy", "washed black".
  colour_name  text,
  fabric       text,
  fit          text check (fit is null or fit in ('slim', 'regular', 'relaxed', 'oversized')),
  -- For dressing Wellington's weather: a linen shirt is light, a car coat warm.
  warmth       text check (warmth is null or warmth in ('light', 'mid', 'warm')),
  brand        text,
  size         text,
  notes        text,
  slot_id      bigint references blueprint_slots (id) on delete set null,
  -- The shop product it was bought as, when it came from a find or a link.
  product_id   bigint references products (id) on delete set null,
  photo_id     bigint unique references wardrobe_photos (id) on delete set null,
  -- How it came in: a slot marked owned, a find bought, a pasted link, a
  -- photo, or typed.
  source       text not null check (source in ('slot', 'find', 'link', 'photo', 'typed')),
  -- Set by the edit form only. A piece made for a slot and never edited is a
  -- placeholder, and goes again if the slot stops being owned.
  edited_at    timestamptz,
  -- Worn out or given away. Kept, so a look that used it can say so.
  set_aside_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index wardrobe_pieces_slot on wardrobe_pieces (slot_id)
  where slot_id is not null and set_aside_at is null;
create index wardrobe_pieces_garment on wardrobe_pieces (garment_type) where set_aside_at is null;

create trigger wardrobe_pieces_updated_at
  before update on wardrobe_pieces
  for each row execute function set_updated_at();

-- Every slot already marked owned is a piece he has.
insert into wardrobe_pieces (name, garment_type, colour_hex, colour_name, fabric, fit, slot_id, source)
select name, garment_type, lower(colours[1]), colour_family, fabrics[1], fit, id, 'slot'
from blueprint_slots
where status = 'owned'
order by priority, position, id;
