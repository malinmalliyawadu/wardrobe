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

`npm run health` checks the database, Claude and the photo store from the
shell. Locally photos go to `PHOTOS_DIR`; leave the `R2_*` settings empty.

`APP_PASSWORD` unset (as in `.env.example`) leaves the local app open; set it
to try the sign-in.

## Deploy to Coolify

One Postgres and one application, in the same Coolify project and
environment so they share a private network, and a Cloudflare R2 bucket for
the photos, so they never fill the server. The app is the `Dockerfile`; it
runs its migrations on boot and refuses to serve if one fails. Do the steps
in this order: the data goes in before the app first starts.

### 1. Postgres

1. **New resource → Databases → PostgreSQL**, version 17 (the same major as
   the local Homebrew server, so a local dump restores cleanly).
2. Start it. On its page, copy the **Postgres URL (internal)**. That is the
   app's `DATABASE_URL`.
3. **Backups → + Add** a daily schedule. The profile, the guide and the
   blueprint cost Opus calls and Malin's time to remake.

### 2. Bring the local data across

Run these on the laptop. The dump carries `schema_migrations`, so the app sees
every migration as applied.

```bash
mkdir -p ~/Desktop/wardrobe-move && pg_dump --format=custom --no-owner --no-acl wardrobe > ~/Desktop/wardrobe-move/wardrobe.dump
```

On the Postgres resource: **Backups → Import backup**, upload `wardrobe.dump`,
leave the restore options as they are, start the restore and watch
**Database Restore Output** to the end. The photos go up at step 3.

### 3. The photos, in R2

1. In the Cloudflare dashboard: **R2 Object Storage → Create bucket**, name
   `wardrobe-photos`, location Automatic, storage class Standard. Leave
   **Public access** off: the app is the only way in.
2. **R2 Object Storage → API → Manage API tokens → Create Account API
   token**: permission **Object Read & Write**, applied to
   `wardrobe-photos` only, no expiry. It shows the **Access Key ID** and
   **Secret Access Key** once; they are `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY`. The **Account ID** on the R2 overview page is
   `R2_ACCOUNT_ID`.
3. Copy the local photos up. Put the four `R2_*` settings in the laptop's
   `.env` for this one command, then take them out again, so local uploads
   go back to the folder:

   ```bash
   npm run photos:move
   ```

   It ends with a `move.done` line saying `"ok":true`: every file a row
   names is in the bucket. Then delete `~/Desktop/wardrobe-move`: it holds
   his profile.

### 4. The application

1. **New resource → Application → GitHub**, `malinmalliyawadu/wardrobe`,
   branch `main`, build pack **Dockerfile**, port `3000`. Use the GitHub App
   source finance-tracker uses, so a push to `main` deploys.
2. **Domains**: the `https://` address it should answer on.
3. **Environment variables**, all runtime, none ticked as build variables
   (the build needs no secret and runs with the network off):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the internal URL from step 1 |
   | `ANTHROPIC_API_KEY` | an Anthropic API key |
   | `OPENAI_API_KEY` | the OpenAI key, for try-ons only |
   | `APP_PASSWORD` | the sign-in password. Long, and not used anywhere else |
   | `R2_ACCOUNT_ID` | from step 3 |
   | `R2_ACCESS_KEY_ID` | from step 3 |
   | `R2_SECRET_ACCESS_KEY` | from step 3 |
   | `R2_BUCKET` | `wardrobe-photos` |

   Leave `PGSSLMODE` unset: the database is on the private network. No
   persistent storage: the photos are in R2.
4. **Health check**: the image has its own (`/api/health/live`, the database
   only, so a Claude outage never takes the app down). If Coolify's is
   switched on, give it the same path and port 3000.
5. **Deploy.** The log shows `migrate.complete` with `applied: 0` after the
   import, then `Ready`.

### 5. The nightly finder

On the application: **Scheduled tasks → + Add**.

| Field | Value |
|---|---|
| Name | `finder` |
| Command | `npm run find` |
| Frequency | `0 2 * * *` if the server's timezone is Pacific/Auckland, `0 13 * * *` if it is UTC (2am in summer, 1am in winter) |
| Container name | empty |
| Timeout | `3600` |

Coolify's default timeout is 300 seconds, and the run takes longer than that:
about 2.5 minutes to read the stores, then scoring and statement pieces. The
spend is capped on /you/finder (US$1 a night for finds and US$0.50 for
statement pieces by default). **Execute now** once and check
**Recent executions** ends with a `find.complete` line.

**Run now** on /you/finder starts this same command inside the app's own
container, with its output in the app's log. Only one run goes at a time: a
run that finds another going logs `find.busy` and exits 0 without starting, so
a run started by hand late in the evening makes the scheduled one a no-op.

### 6. Check it

- Sign in at the domain. `/api/health` (signed in) says ok for the database,
  Claude and Photos (`R2 bucket wardrobe-photos is writable`).
- On the iPhone, in Safari: **Share → Add to Home Screen**. It opens as
  Wardrobe, with the palette strip as its icon, signed in.

## Moving a running deploy off its volume

Once, for the app that kept photos on the `wardrobe-data` volume at `/data`
before they moved to R2 (2026-11-07). Leave the volume mounted until the end.

1. Make the bucket and its key: step 3, items 1 and 2.
2. On the application, add the four `R2_*` environment variables (step 4.3)
   and deploy the commit that brings R2. From then on new photos go to the
   bucket, and the older ones show as missing until the next item, so do it
   straight away.
3. On the application: **Terminal**, then

   ```bash
   npm run photos:move
   ```

   It copies everything in `/data/photos` up, checks each file's MD5 against
   the bucket's, and ends with `move.done` and `"ok":true` once every file a
   row names is there. Run it again if anything failed: what already landed
   is not sent twice.
4. Check the app shows his photos, try-ons and the outfit of the day, then
   free the disk:

   ```bash
   npm run photos:move -- --prune
   ```

   It deletes each local file only once the bucket's copy matches.
5. **Persistent storage**: delete the `/data` volume mount, and the volume
   itself if Coolify offers to, then deploy. `/api/health` says
   `R2 bucket wardrobe-photos is writable`.
