# Verification record

What has actually been run, and what has not. Anything not listed here as
executed should be treated as unverified.

## Environment

| | |
|---|---|
| Date | 7 September 2026 |
| Branch | `codex/reliability-and-docs` |
| Baseline SHA | `f679f50c0ea924d398506cc8c54026b09bcf713f` |
| Node | v24.20.0 |
| npm | 11.6.2 |
| Host | macOS 27.0, arm64 |
| MongoDB | 8.0.29, single-node replica set `rs0` via `compose.yaml`, loopback only |
| Gemini / YouTube | **not called.** Every test injects a fake provider. |

## Commands and results

Run from a clean checkout with `MONGO_URI_TEST` pointing at
`text_to_learn_test` on the local replica set.

| Command | Result |
|---|---|
| `npm --prefix server ci` | succeeds; leaves the tracked tree unchanged |
| `npm --prefix client ci` | succeeds; leaves the tracked tree unchanged |
| `npm --prefix server test` | **76 passed, 0 failed** |
| `npm --prefix server run test:integration` | **37 passed, 0 failed** |
| `npm --prefix client test` | **93 passed, 0 failed** (7 files) |
| `npm --prefix client run lint` | clean, no warnings |
| `npm --prefix client run build` | succeeds |
| `node scripts/check.mjs` | all five steps pass |

Total: **206 automated tests**, all passing.

`npm ci` was additionally verified in clean copies of each package root
containing only `package.json`, `package-lock.json` and `.npmrc`. Installing
under Node 25 was confirmed to fail with `EBADENGINE`, which is the intent of
`engine-strict`.

## What each layer actually covers

**Unit (`server/tests/unit`, no database, no sockets, no network)**

- `schemas.test.js` — the generation contract: required fields, the 3–6 lesson
  rule, MCQ answers bounded by their own options, unknown block types.
- `gemini.test.js` — validate, repair once, fall back; the shared 25-second
  model deadline across both rounds; a repair that does not start once the
  budget is gone; cancellation raised instead of a fallback. The transport
  cases drive the **real installed SDK** with `global.fetch` replaced and a
  fixed fake key: 400/401/403 fail after one attempt, 429/503 retry within the
  budget, a missing key makes zero requests.
- `resilience.test.js` — abort before the first attempt, during an attempt and
  during a backoff sleep; an expired deadline; a Retry-After that cannot fit
  the budget; an uncooperative callback that cannot hang the wrapper and whose
  late rejection is consumed; Retry-After as seconds and as an HTTP date. Plus
  the YouTube stage: its own budget degrades to `unavailable`, while parent
  cancellation and an exhausted parent budget propagate.
- `generationStatus.test.js` — legacy classification, including a lesson that
  quotes the fallback sentence and stays `ready`, and an outline whose title
  suffix alone is not enough to condemn it.
- `lessonGeneration.test.js` — ready skipped with zero calls and zero writes,
  degraded regenerated without `force`, force replacing only after a successful
  preparation, one save per generation, previous content intact after a failure.
- `errors.test.js` — the full public error table; no SDK text, no Mongoose
  text, and no submitted value echoed back.
- `pdf.test.js` — a successful export parsed with `pdf-lib` (page count ≥ 1),
  a synchronous render failure leaving no headers behind, an asynchronous
  pipeline failure, a disconnect destroying the producer, and no unhandled
  rejection in any of them.
- `measureReads.test.js` — argument validation and the p95 definition.

**Integration (`server/tests/integration`, real Express on loopback, real
replica set, faked providers)**

- `routes.test.js` — lesson GET/POST semantics, bodyless and `{}` bodies,
  rejected option shapes, parity between the single-lesson route and the bulk
  stream, the module/`done` event contract, a lesson persisted and returned
  when YouTube is unavailable, and a replayed transaction callback building
  fresh documents with preallocated module ids and no backfill pass.
- `cancellation.test.js` — a lesson request aborted with no body and with `{}`,
  released only once the server has observed the disconnect, after which no
  enrichment and no write occur; a bulk stream stopping before the next lesson;
  a request deadline emitting exactly one `generation_timeout` and no `done`;
  lessons saved before the deadline surviving it and being skipped on retry;
  the heartbeat interval cleared.
- `persistence.test.js` — bidirectional links after creation, **rollback with
  zero persisted records** after an injected failure between module writes, a
  stored lesson unchanged after a failed regeneration (`updatedAt` included),
  no duplicate write for a ready lesson, the HTTP error table at the real route
  boundary, a real streamed PDF parsed with `pdf-lib`, `/healthz`, and list
  paging at 0/20/21 records with strict pagination rejection.
- `migration.test.js` — dry run writing nothing, apply classifying each
  fixture, content and `updatedAt` preserved, a second run applying zero
  writes, and a stale proposal matching nothing.
- `startup.test.js` — in isolated child processes: missing configuration exits
  1 without listening; an unreachable database exits 1 without listening and
  without echoing the connection string; a healthy start listens on loopback
  and exits 0 on SIGTERM.

**Client (`client/tests`, jsdom, mounted components, mocked HTTP/SSE)**

- `api.test.js` — the envelope, an HTML error page reported by status, a 200
  carrying an error envelope, an undecodable body, AbortError passing through,
  and shape validation.
- `sse.test.js` — a valid record split at **every byte offset**, including
  mid-character for multibyte text; CRLF boundaries; several records in one
  chunk; heartbeats and unknown events ignored; malformed records; clean EOF
  with and without a preceding module; records after a terminal one ignored.
- `progressiveGeneration.test.js` — reducer token discipline: stale START and
  CANCEL, mismatched and missing tokens, events after a terminal state,
  immutable module replacement, unique progress counting.
- `CoursePage.test.jsx` — 404 and 500 load states, status badges independent of
  content length, a module enqueued and cancelled in the same act never
  rendering, a cancelled run not disturbing its replacement, unmount mid-stream,
  a deferred course A resolving after B, inconsistent `done` payloads, and the
  PDF fallback path.
- `LessonPage.test.jsx` — pending/degraded/ready rendering, a degraded lesson
  still offering retry, a 502 leaving the lesson intact, a response for another
  lesson rejected, one request under repeated clicks, MCQ selections not
  leaking between lessons.
- `Home.test.jsx` — repeated Enter and repeated clicks producing exactly one
  request, the trimmed topic body, failure restoring the controls.
- `CoursesList.test.jsx` — 0/1/19/20/21/40/41 record fixtures, exact page and
  limit requests, page-two failure and retry, rapid Next producing one request,
  and rejected envelopes.

## Not verified

These are open, not oversights being glossed over:

- **No live Gemini or YouTube call has been made.** Every model and video
  result in every test is injected. Nothing here says anything about real
  provider latency, real quota behaviour, real 429 handling against Google's
  actual rate limiter, or the cost of a real course.
- **No course-creation latency figure exists.** Creating a course requires a
  billed model call, so there is no automatic benchmark and no measured number.
  Do not infer one from the 25-second model budget: a budget is a limit, not a
  measurement.
- **No read benchmark has been run.** `server/scripts/measure-reads.js` exists
  and its statistics are unit-tested, but it has not been executed against a
  running server. When it is, its output describes the environment named on the
  command line and nothing else — a local read time says nothing about a hosted
  database.
- **No manual browser session has been run.** The component tests mount real
  components in jsdom; they are not a browser, and they do not exercise a real
  PDF download, a real file save dialog, or real network conditions.
- **No PDF has been opened in a viewer.** `pdf-lib` confirms the bytes parse
  and contain at least one page. That is a parsing result, not a statement
  about layout or readability.
- **The migration has never been applied to real data.** It has been run
  against seeded fixtures on the disposable test database only.
- **CI has not yet run on a pull request** at the time of writing.

## How to add to this record

Record the command, the environment, the counts you actually saw, and whether
providers were faked or live. If a check did not run, say so here rather than
leaving it out.
