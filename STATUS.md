# STATUS — Text-to-Learn

_Updated 2026-07-05. Supersedes the 2026-06-13 Phase-0 audit below, which was
written before real Gemini/YouTube integration and the checkpoint work
existed. This build-out closed the four resume acceptance criteria, all three
learning checkpoints, and the remaining gaps from the build spec._

---

## 1. What changed in this pass

### Non-checkpoint hardening (build spec §5, §8 other missing pieces)
- **Atomic course creation** — `createCourse` now wraps the Course/Module/Lesson
  multi-write loop in a single Mongoose transaction (`session.withTransaction`).
  A mid-loop failure leaves nothing persisted (previously: orphaned docs).
  *Requires a replica set (Atlas qualifies). A standalone/local Mongo without
  a replica set will reject transactions — fall back to best-effort cleanup
  if you deploy against one.*
- **Indexes + measured latency** — `Course.createdAt` is indexed for the list
  endpoint's sort; `GET /:id` (already a single indexed `_id` lookup) logs its
  query time on every request (`[getCourse] <id> lookup in N.NNms`).
  `createCourse` similarly logs total wall time
  (`[createCourse] "<title>" (N modules) generated + persisted in Nms`).
  **Real numbers need to be captured on a machine with network access to your
  Atlas cluster + Gemini** — this sandbox has no outbound network (see §4) —
  paste them here once you've run the app.
- **Server-side PDF export** — `GET /api/courses/:id/pdf` streams a pdfkit-
  rendered PDF (new `services/pdf.js`), satisfying the spec's PDF acceptance
  criterion literally. The client's PDF button now hits this endpoint first
  and falls back to the original client-side jsPDF export (`src/pdf.js`) if
  the server request fails for any reason.
- **Error envelope + validation** — all routes now respond with
  `{ error: { code, message } }` (new `utils/errors.js`), with a shared Express
  error-handling middleware. `topic` is validated (non-empty, trimmed, ≤200
  chars) → 400. A malformed ObjectId now correctly 400s (`CastError`) instead
  of 500ing; a real not-found still 404s.
- **CORS + fail-fast** — CORS origin is now `CLIENT_ORIGIN` env-configurable
  (open/reflects-origin by default for local dev). A Mongo connection failure
  now logs a loud, actionable error instead of silently leaving the server up
  with every request 500ing forever — **verified in this sandbox**: pointing
  at the real `MONGO_URI` here (no network) produced
  `MongoDB connection failed: querySrv ENOTFOUND ...` immediately, not a hang.
- **My Courses page** — new `client/src/pages/CoursesList.jsx` at `/courses`,
  wired to the previously-unused `GET /api/courses` list endpoint; linked
  from the home page.
- **`.env.example`** — documented `CLIENT_ORIGIN` addition.

### Checkpoint 1 — LLM structured-output contract & repair (server/services/gemini.js)
- New `services/schemas.js`: Zod is the single source of truth for the course
  and lesson shapes (`CourseSchema`, `LessonSchema`, `ContentBlockSchema`),
  plus a hand-written `COURSE_RESPONSE_SCHEMA` fed to Gemini's
  `responseSchema` for constrained decoding on the course skeleton (the
  lesson content union is too dynamic for Gemini's OpenAPI-subset schema, so
  that path relies on validate+repair+fallback alone — noted as a deliberate
  tradeoff, not an oversight).
- `validateCourse`/`validateLesson` — pure, never throw, return `{ ok, errors }`.
- `generateCourseSafe`/`generateLessonSafe` — call → validate → **exactly one**
  repair re-prompt (feeding the model its own broken output + validation
  errors) → **safe, clearly-labelled fallback** if repair also fails. Never
  leaks a raw `JSON.parse` `SyntaxError` to the caller.
- `courseController.createCourse` and `lessonRoutes.js` now call the `*Safe`
  variants exclusively.
- **`server/tests/checkpoint1.gemini.test.js`** — all 5 tests un-skipped and
  passing, using an injected fake `modelCall` (zero network).

### Checkpoint 2 — External-API resilience (Gemini + YouTube)
- New `services/resilience.js`: reusable `withResilience(fn, opts)` — AbortController
  timeout, exponential backoff **with full jitter**, a 429/quota-vs-5xx policy
  split (429 honors `Retry-After`/backs off much harder; ordinary 5xx/network
  errors get the normal schedule; non-429 4xx doesn't retry at all), bounded
  attempts, and a single typed `UpstreamError` on final failure.
- Wired into both `gemini.js`'s `callModel` (via the SDK's native
  `signal`/timeout support) and `youtube.js`'s `fetch` call.
- `searchVideos` now returns `{ videos, enrichmentStatus }` where status is
  one of `no_key | ok | no_results | unavailable` — a quota-exhausted key is
  now distinguishable from "this topic just has no videos" (previously both
  silently produced `[]`). `Lesson.enrichmentStatus` persists this.
- **`server/tests/checkpoint2.resilience.test.js`** — all 5 tests un-skipped
  and passing (timeout-abort, backoff growth, 429 vs 500 policy, bounded
  attempts + typed error, YouTube-down-but-lesson-still-succeeds).

### Checkpoint 3 — Progressive generation UX + frontend state machine
- New `client/src/generationReducer.js`: pure `generationReducer(state, action)`
  — `idle → generating → done`, plus `error`. Actions `START`, `MODULE_RECEIVED`,
  `DONE`, `ERROR`, `CANCEL`. A monotonically-bumped `token` (on `START`/`CANCEL`)
  guards against a cancelled/superseded generation's late results mutating
  the current view.
- New server endpoint `POST /api/courses/:id/generate-content` (SSE):
  generates each module's lessons (content + YouTube) in order and streams
  one `event: module` per completed module, `event: done` at the end, or
  `event: error` mid-stream (previously-sent modules stay valid/rendered).
  Detects the client closing the connection (Cancel) via `req.on('close')`
  and stops doing further generation work.
- `CoursePage.jsx`: `useReducer(generationReducer)` drives a "Generate full
  course" flow that reads the SSE stream via `fetch` + `ReadableStream.getReader()`
  (SSE over POST, so `EventSource` — GET-only — doesn't apply), dispatching
  the reducer actions as records arrive; each module's lessons are rendered
  live as they land. A Cancel button aborts the fetch (`AbortController`) and
  bumps the token; an error keeps whatever modules already completed, with
  a Retry action. Effect cleanup aborts on unmount/navigation.
- **`client/tests/progressiveGeneration.test.js`** — all 4 tests un-skipped
  and passing.

---

## 2. Acceptance criteria (build spec §1) — status

| Claim | Criterion | Status |
|---|---|---|
| multi-module course < 30s | `POST /api/courses/generate` timed & logged | **Mechanism in place** (`[createCourse] ... in Nms` log). Real number needs a run with network access — see §4. |
| sub-100ms read | `GET /api/courses/:id` timed, indexed lookup | **Mechanism in place** (`[getCourse] ... in N.NNms` log + `createdAt` index). Real number needs a run with network access. |
| resource curation | ≥1 curated video per module | Per-lesson YouTube search unchanged in shape, now resilient + degradation-observable via `enrichmentStatus`. |
| PDF compile+download | `GET /api/courses/:id/pdf` | **Done** — pdfkit stream, verified by syntax/structure; needs one real download to eyeball the rendered output. |

---

## 3. Test status (verified in this sandbox, no network required)

```
server: npm test  → 10/10 passing
  checkpoint1.gemini.test.js       5/5
  checkpoint2.resilience.test.js   5/5
client: npm test  → 4/4 passing
  progressiveGeneration.test.js    4/4
client: npm run lint   → clean
client: npm run build  → clean (vite build succeeds)
server: node -c <every changed file> → clean
```

## 4. What could NOT be verified from this environment

This sandbox has **no outbound network access** — confirmed by starting the
server here, which correctly fail-fast logged
`MongoDB connection failed: querySrv ENOTFOUND _mongodb._tcp.<cluster>...`
against the real `MONGO_URI` in `server/.env`. The same will be true for
Gemini/YouTube calls. So the following need to be run **on your machine**
(which has real network access) before the resume claims can be published:

1. `cd server && npm run dev` and `cd client && npm run dev`.
2. Submit a topic on the home page → confirm it lands < 30s and note the
   `[createCourse] ... in Nms` server log line.
3. Open the course → note the `[getCourse] ... in N.NNms` log line on load.
4. Click "Generate full course" → confirm modules stream in one-by-one, "Cancel"
   stops it cleanly, and killing the network mid-stream (or unplugging Wi-Fi
   briefly) surfaces the error state while keeping already-generated modules.
5. Click "Export PDF" → confirm a real multi-page PDF downloads.
6. Visit `/courses` → confirm the list renders.
7. Optionally: temporarily unset `YOUTUBE_API_KEY` (or use an invalid one) →
   confirm lessons still generate, `enrichmentStatus` shows `no_key` /
   `unavailable`, and `videos: []`.

Paste the real timings back into §2 above once captured, then reconcile the
resume's "<30s" / "sub-100ms" language to match.

---

## 5. Known constraints / tradeoffs (for the interview defense checklist)

- Transactions in `createCourse` require a replica set; Atlas provides one.
  A standalone local Mongo would reject `session.withTransaction`.
- Gemini's `responseSchema` (constrained decoding) is only applied to the
  course skeleton — its OpenAPI-subset schema can't express the lesson
  content block's discriminated union, so lesson generation relies on
  validate + repair + fallback alone. This is a real, defensible limitation
  of the API, not a shortcut.
- The SSE progressive-generation endpoint is POST-based (course generation
  needs a request body / is triggered by a button, not a plain navigable
  URL), so the client uses `fetch` + `ReadableStream` rather than
  `EventSource` (which is GET-only). Framing this tradeoff is a good
  interview answer to "why not just use EventSource?".
- The normalized `Course → Module → Lesson` (ObjectId + populate) model was
  kept as-is rather than migrating to the build spec's denormalized
  `Module.sections`/`Module.resources` sketch, per the spec's own "don't
  rewrite working code" guardrail. Spec "sections" ≈ `Lesson.content[]`
  blocks; spec "resources" ≈ `Lesson.videos[]`.
