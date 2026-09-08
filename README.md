# Text-to-Learn

Enter a topic and get a structured course: an outline of modules and lesson
titles, lesson bodies generated on demand with Google Gemini, optional related
YouTube videos, and a PDF export of the whole thing.

- **client/** — React 19 + Vite + Tailwind single-page app
- **server/** — Node + Express 5 + Mongoose (MongoDB)

For how the pieces fit together, see [docs/architecture.md](docs/architecture.md).
For what has actually been tested, see [docs/verification.md](docs/verification.md).
To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

1. **Topic → outline.** One model call produces the course skeleton: a title,
   a description, tags, and 3–6 modules of 3–6 lesson titles each. Every lesson
   starts with no body.
2. **Lesson bodies on demand.** Open a lesson and generate it, or generate the
   whole course from the course page and watch modules arrive one at a time.
3. **Retry what did not work.** Model output that fails validation twice is
   replaced by a clearly labelled fallback body. Those lessons are marked
   `degraded` and can be retried; lessons that are already `ready` are reused
   and cost nothing to retry around.
4. **Export.** A course can be downloaded as a PDF, rendered server-side, with
   a client-side fallback if the server export fails.

## Prerequisites

- **Node 24.20.0** and **npm 11.6.2**. The version is pinned in `.nvmrc`, and
  both package roots set `engine-strict=true`, so an unsupported runtime fails
  the install instead of producing a lockfile nobody else can reproduce.
- **MongoDB running as a replica set.** Course creation writes a course, its
  modules and its lessons in one transaction, and MongoDB offers transactions
  only on a replica set. A standalone `mongod` will reject them.
- A **Google Gemini** API key — https://aistudio.google.com/app/apikey
- *Optional:* a **YouTube Data API v3** key. Without it, lessons generate
  normally and simply carry no videos.
- Docker (or Docker Desktop) if you want the local replica set below.

## Local database

`compose.yaml` runs a single-node replica set bound to loopback. Bring it up
and initialise it once:

```bash
docker compose up -d mongo
docker compose exec -T mongo mongosh --quiet --eval 'try { rs.status() } catch (error) { if (error.code === 94) { rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]}) } else { throw error } }'
docker compose exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary'
```

Wait for the last command to print `true` before starting the server. The
initialisation command needs `mongod` to be accepting connections, so if it
fails immediately, wait a few seconds and run it again.

Development URI:

```
mongodb://127.0.0.1:27017/text_to_learn?replicaSet=rs0&directConnection=true
```

MongoDB Atlas works too — an Atlas cluster is already a replica set. Use its
connection string as `MONGO_URI` and skip Docker. If you already have a
configured replica set, use that; nothing here requires Docker specifically.

The named volume holds your courses. Do not run `docker compose down -v` as
part of routine setup or testing: that deletes them.

## Setup

```bash
# Backend
cd server
npm ci
cp .env.example .env        # fill in MONGO_URI and GEMINI_API_KEY

# Frontend
cd ../client
npm ci
cp .env.example .env        # optional; defaults to http://localhost:3001
```

### Environment variables

| File | Variable | Required | Purpose |
|---|---|---|---|
| `server/.env` | `MONGO_URI` | yes | MongoDB connection string (replica set) |
| `server/.env` | `GEMINI_API_KEY` | yes | Course and lesson generation |
| `server/.env` | `GEMINI_MODEL` | no | Model id (default `gemini-2.5-flash`) |
| `server/.env` | `YOUTUBE_API_KEY` | no | Video enrichment; absent means no videos |
| `server/.env` | `PORT` | no | API port (default `3001`) |
| `server/.env` | `HOST` | no | Bind address (default `127.0.0.1`) |
| `server/.env` | `CLIENT_ORIGIN` | no | Allowed CORS origin (default `http://localhost:5173`) |
| `server/.env` | `API_ACCESS_TOKEN` | no locally, **yes deployed** | Shared secret required on every `/api` request |
| `server/.env` | `TRUST_PROXY` | no | Proxy hops to trust, as an integer. Required behind a load balancer |
| `client/.env` | `VITE_API_URL` | no | Backend base URL (default `http://localhost:3001`) |
| `client/.env` | `VITE_API_TOKEN` | matches the server | Sent as `X-API-Token` |

The server binds loopback by default. Serving a public interface is a
deliberate deployment decision: set `HOST` and `CLIENT_ORIGIN` explicitly.
`.env` files are gitignored — never commit real keys.

## Running

```bash
cd server && npm run dev     # http://127.0.0.1:3001
cd client && npm run dev     # http://localhost:5173
```

`GET /healthz` reports readiness: 200 when the database connection is live,
503 otherwise. The server refuses to start at all if required configuration is
missing or the database is unreachable.

## Tests

```bash
# Server unit tests: no database, no sockets, no network
npm --prefix server test

# Server integration tests: real Express on loopback, real test replica set
export MONGO_URI_TEST="mongodb://127.0.0.1:27017/text_to_learn_test?replicaSet=rs0&directConnection=true"
npm --prefix server run test:integration

# Client component tests, lint and production build
npm --prefix client test
npm --prefix client run lint
npm --prefix client run build
```

`node scripts/check.mjs` runs all of the above in order and stops at the first
failure. It installs nothing, starts nothing and touches no application data;
bring up the replica set and set `MONGO_URI_TEST` first.

Model and video providers are always faked in tests. The integration database
name must end in `_test`, and only that database is ever cleared.

## Migrating existing data

Documents written before the explicit status fields existed carry no
`generationStatus` or `outlineStatus`. Reads derive an effective value for
them, so nothing breaks, but the backfill makes the stored data match:

```bash
npm --prefix server run migrate:status              # report only
npm --prefix server run migrate:status -- --apply   # write
```

It is a dry run by default, writes metadata only, leaves lesson content and
`updatedAt` untouched, and is safe to re-run. Take a snapshot first if the data
matters.

## Deploying

The generation endpoints each cost a billed Gemini call. An ungated public
URL is therefore an open billing endpoint, and an unlisted URL is not a
private one: certificates for `*.vercel.app`, `*.onrender.com` and the like
are published to public Certificate Transparency logs within minutes, and
scanners read them. Before any deployment:

1. **Set `API_ACCESS_TOKEN`** on the server and the same value as
   `VITE_API_TOKEN` on the client. Generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Every `/api` request must then carry it as `X-API-Token`; `/healthz` and
   `/` stay open so a platform health check still works.
2. **Set `HOST=0.0.0.0`** if the platform requires it, and `CLIENT_ORIGIN` to
   the deployed client's origin.
3. **Set `TRUST_PROXY=1`** behind a single platform load balancer, so the
   rate limiter sees the real client address. Trusting more hops than
   actually exist lets a client spoof its address and bypass the limiter, so
   do not guess high.
4. **Use a replica set** for `MONGO_URI` — Atlas qualifies.
5. **Run the status migration** against that database once (see above).
6. **Cap your Gemini spend** in the Google Cloud console. The rate limiter
   bounds requests per client; a billing cap bounds the bill.

Rate limits, per client address per 15 minutes: **20** generation requests
and **600** requests overall. Exceeding either returns
`429 rate_limited`.

`API_ACCESS_TOKEN` is a deployment gate, not authentication. It is one
secret shared by every caller, with no identity behind it, and the client
copy is compiled into the JavaScript bundle where anyone who opens devtools
can read it. It keeps crawlers and drive-by scanners off the paid
endpoints. It is not a substitute for user accounts.

## Limitations

- Single user, no accounts, no authorisation. Anyone holding the shared
  `API_ACCESS_TOKEN` can read and modify every course; there is no per-user
  ownership.
- No cross-process locking. Two concurrent generations of the same lesson are
  not coordinated; the last write wins.
- Optional YouTube enrichment may return nothing, for a missing key, a failed
  lookup, or a topic with no matching videos. There is no guarantee of a video
  per lesson or per module.
- A degraded outline has no in-place regeneration endpoint. Creating a new
  course is the recovery path.
- A course with many lessons may exceed the ten-minute stream budget; already
  generated lessons are kept and skipped when you retry.
- Generation timing depends on the provider and has not been benchmarked. See
  [docs/verification.md](docs/verification.md) for what has and has not been
  measured.
