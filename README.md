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

`npm run health` checks the database, Claude and the photos folder from the
shell.

`APP_PASSWORD` unset (as in `.env.example`) leaves the local app open; set it
to try the sign-in.

## Deploy to Coolify

One Postgres and one application, in the same Coolify project and
environment so they share a private network. The app is the `Dockerfile`; it
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

```bash
tar -C /Users/malin/Projects/wardrobe/data -czf ~/Desktop/wardrobe-move/photos.tgz photos
```

On the Postgres resource: **Backups → Import backup**, upload `wardrobe.dump`,
leave the restore options as they are, start the restore and watch
**Database Restore Output** to the end. The photos go in at step 4, once the
app's volume exists.

### 3. The application

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

   Leave `PGSSLMODE` unset: the database is on the private network.
4. **Persistent storage → + Add → Volume mount**, name `wardrobe-data`,
   destination path `/data`. A volume, not a directory mount: the app runs
   as a non-root user, and a host directory belongs to root, so photos would
   read but every upload would fail.
5. **Health check**: the image has its own (`/api/health/live`, the database
   only, so a Claude outage never takes the app down). If Coolify's is
   switched on, give it the same path and port 3000.
6. **Deploy.** The log shows `migrate.complete` with `applied: 0` after the
   import, then `Ready`.

### 4. The photos

From the laptop, with the server's SSH host and the app container's name
(the application's page shows it):

```bash
scp ~/Desktop/wardrobe-move/photos.tgz <server>:/tmp/photos.tgz
```

```bash
ssh <server> 'docker exec -i <container> tar -xzf - -C /data < /tmp/photos.tgz && rm /tmp/photos.tgz'
```

`docker exec` runs as the app's own user, so the files land owned by it.
Then delete `~/Desktop/wardrobe-move`: it holds his photos and profile.

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
  Claude and the photos volume.
- On the iPhone, in Safari: **Share → Add to Home Screen**. It opens as
  Wardrobe, with the palette strip as its icon, signed in.
