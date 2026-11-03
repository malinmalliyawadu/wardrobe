# Wardrobe

A personal stylist for one person. It learns what suits you from a few photos
and your measurements, drafts a blueprint of what to own, and every night finds
real products from Wellington and ships-to-NZ menswear retailers that fill a
slot in that blueprint.

See [docs/plan.md](docs/plan.md) for the product and build plan, and
[docs/schema.md](docs/schema.md) for the data model.

## Run it

Needs Node 24 and a Postgres 17 database.

```bash
cp .env.example .env
createdb wardrobe
npm install
npm run db:migrate
npm run dev
```

`npm run health` checks the database and Claude from the shell.
