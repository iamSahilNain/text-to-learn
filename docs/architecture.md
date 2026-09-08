# Architecture

Current state of the system. For setup, see [../README.md](../README.md).

## Shape

```
Home ──POST /api/courses/generate──▶ Gemini (outline)
                                          │
                                          ▼
                                 one transaction:
                                 Course + Modules + Lessons
                                          │
CoursePage ◀──GET /api/courses/:id────────┘
   │
   ├─POST /api/courses/:id/generate-content ──▶ SSE: module… module… done|error
   │        (per lesson: Gemini body, then optional YouTube)
   │
   └─GET /api/courses/:id/pdf ──▶ PDFKit ──▶ streamed download

LessonPage ──POST /api/lessons/:id/generate──▶ the same shared lesson service
```

## Data model

Three collections joined by ObjectId references, with back-references:
`Course.modules`, `Module.course`, `Module.lessons`, `Lesson.module`.

Storage stays normalised because a lesson is the unit of work. Generating one
lesson rewrites one small document. With the whole course embedded in a single
document, every lesson generation would rewrite the entire course, and a large
course would approach MongoDB's 16 MB document limit. The cost is that reads
use `.populate()`, which is acceptable at this size.

`Lesson.content` is an ordered array of typed blocks — `heading`, `paragraph`,
`code`, `mcq` — stored as `Mixed`. Blocks let the renderer and the PDF exporter
switch on `type` and treat a quiz as real data with a checkable answer rather
than prose. The database schema stays loose on purpose: the real contract is
enforced at the generation boundary by `services/schemas.js`, so adding a block
type does not require a migration.

## Status fields

Three independent pieces of state, deliberately not collapsed into one:

| Field | Values | Means |
|---|---|---|
| `Course.outlineStatus` | `ready`, `degraded` | The quality of the **outline** alone. A degraded outline can still contain ready lessons. |
| `Lesson.generationStatus` | `pending`, `ready`, `degraded` | Whether a usable body has been persisted. `degraded` is the labelled local fallback. |
| `Lesson.enrichmentStatus` | `pending`, `no_key`, `ok`, `no_results`, `unavailable`, `unknown` | The outcome of the optional YouTube lookup. Independent of generation. |

`Lesson.isEnriched` means an enrichment decision completed, not that videos
were found. A module has **no** stored status: it is derived from its lessons
(any pending → pending, else any degraded → degraded, else ready), because a
persisted module flag would survive a cancelled request and lie.

Neither status field has a schema default. A default would make documents
written before the field existed indistinguishable from genuinely ungenerated
ones. `services/generationStatus.js` derives an effective value for those from
the exact shapes the old fallback generators produced — full equality on every
marker, so a lesson that merely quotes the fallback sentence stays `ready`.
`scripts/migrate-generation-status.js` backfills the stored values.

## Generation

`services/lessonGeneration.js` is the single generate-and-persist path, shared
by the lesson route and the bulk stream, so their persisted fields cannot
diverge. It skips a ready lesson without any upstream call or write, generates
into local variables, runs optional enrichment, and writes content, videos,
enrichment and status in **one** save. A failure leaves the previously
persisted lesson exactly as it was; no compensating "failed" document is
written.

`generateCourseSafe` and `generateLessonSafe` call, validate, repair once, and
only then fall back. The fallback is for **invalid model output** alone. A
transport failure, a missing key, a cancellation or an exhausted budget all
propagate as typed errors — none of them ever becomes a lesson.

## Budgets and cancellation

`services/requestContext.js` binds each request to an abort signal and a
monotonic deadline, registered before the first lookup. It listens on the
response's `close` event: the request's own `close` can fire as soon as the
body has been parsed, well before the response is finished, so it is not a
usable disconnect signal.

| Scope | Budget | Attempt cap | Attempts |
|---|---:|---:|---:|
| Model stage (first round + repair) | 25,000 ms | 10,000 ms | 3 |
| YouTube enrichment | 6,000 ms | 2,000 ms | 3 |
| One lesson operation | 35,000 ms | composed | — |
| Outline request | 35,000 ms | composed | — |
| Full-course stream | 600,000 ms | per-lesson limits apply | — |

Each stage's deadline is the earlier of its own budget and its parent's.
`withResilience` checks cancellation and remaining budget at entry, before
every attempt, and on both sides of every backoff sleep; a retry delay that
cannot fit the remaining budget ends the stage as a timeout rather than
retrying early against the provider's guidance. Cancellation always wins over
retry classification.

These are operation budgets, not a delivery guarantee. A database commit that
has already started will finish; a cancellation arriving afterwards does not
undo it, and nothing in the system claims otherwise.

## Cancellation and commits

A cancelled generation stops before the next external call and before the next
write. A write already in flight is allowed to settle. Lessons committed before
the cancellation stay committed — which is what makes a retry cheap, since they
are then `ready` and skipped.

## Deployment guards

Production requires `APP_USERNAME` and `APP_PASSWORD`; the HTTP Basic gate
protects all pages, assets and API routes. Only `/healthz` is public. Credentials
are compared using constant-time digest comparison and never compiled into the
frontend. Browser mutations with an Origin different from `CLIENT_ORIGIN` are
rejected. Local development can omit both login variables.

Caddy terminates HTTPS and proxies to Express over the private Compose network.
Express serves the frontend build and SPA deep links from the same origin as the
API. `TRUST_PROXY=1` trusts that one proxy; do not expose the app port directly.

Per-IP limits allow 20 generation requests and 600 API requests per 15 minutes.
The limits are process-local. Generation may involve multiple model calls, so
these are request limits, not a spending cap. All authenticated users share the
same courses. See [deployment instructions](deployment.md).

## Errors

`utils/errors.js#normalizeError` is the only place an error becomes a public
response. Every JSON error is `{ error: { code, message } }`.

| Condition | HTTP | Code | Retriable |
|---|---:|---|---|
| Missing or wrong app login | 401 | `unauthorized` | no |
| Rate limit exceeded | 429 | `rate_limited` | yes |
| Invalid topic | 400 | `invalid_topic` | no |
| Malformed ObjectId | 400 | `bad_id` | no |
| Invalid generation options | 400 | `invalid_request` | no |
| Malformed JSON body | 400 | `invalid_json` | no |
| Invalid pagination values | 400 | `invalid_pagination` | no |
| Body over 100 KB | 413 | `request_too_large` | no |
| Missing resource | 404 | `not_found` | no |
| Missing Gemini configuration | 503 | `service_unavailable` | no |
| Exhausted upstream call | 502 | `upstream_unavailable` | from the typed error |
| Deadline exhausted or cancelled | 504 | `generation_timeout` | yes |
| Database or unexpected failure | 500 | `internal_error` | yes |

Messages are fixed public strings. Body-parser failures are recognised by their
`type`, not by trusting an arbitrary `error.status`. A `CastError` reports only
its category — the submitted value is never echoed back. An upstream error
keeps its own retriable flag, so an HTTP 403 wrapped as a 502 is still reported
as not worth retrying.

## Streaming

`POST /api/courses/:id/generate-content` returns `text/event-stream`.

- `event: module` — the full populated module, emitted only once every lesson
  in it has been generated or skipped.
- `event: done` — `{courseId, status, readyLessons, degradedLessons,
  totalLessons}`. `status` is `complete` when nothing is degraded, `degraded`
  otherwise. Counts cover the whole course, skipped ready lessons included, so
  ready + degraded always equals total.
- `event: error` — `{code, message, retriable}`, terminal, followed by the end
  of the response. Never sent together with `done`.
- `: keepalive` comment frames every 10 seconds. They are not progress.

A client that has disconnected receives nothing further. `client/src/sse.js` is
the consumer: it handles LF and CRLF boundaries, records split at any byte
offset including mid-character, several records in one chunk, and unknown event
types. A stream that ends without a terminal record is reported as an
interruption — the number of module records received is never treated as proof
of completion.

## PDF export

`services/pdf.js` renders the document **before** connecting it to the
response, so a synchronous render failure happens with no headers sent and the
ordinary JSON error path is still available. Only then is the document piped to
the response, and the returned promise settles when the last byte has landed or
the pipeline has failed. A client disconnect destroys the producer rather than
rendering a course nobody is reading. Output uses the base-14 PDF fonts, so
glyph coverage is Latin-1; text outside that range renders as substitutes.

## List endpoint

`GET /api/courses?page=1&limit=20` returns
`{courses, page, pageSize, hasMore}`. The query fetches one record more than
the page size and derives `hasMore` from it, so an exactly full page does not
claim another one exists. Sorting is `createdAt` then `_id`, both descending,
matching the compound index — the `_id` tiebreaker is what keeps paging stable
when several courses share a timestamp.

## Deliberately absent

No accounts, no per-user authorisation, no job queue, no cross-process
locking, no caching layer. This is a single-process demo; each of those would be a real
requirement for a deployment, and none is pretended to exist.
