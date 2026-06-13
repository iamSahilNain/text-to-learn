# Glossary

Terms used across this codebase and its docs.

### Domain

- **Course / Module / Lesson** — the three-level content hierarchy. A *course*
  has ordered *modules*; a module has ordered *lessons*; a lesson holds the
  actual teaching content. Lessons are the leaf and the unit of generation.
- **Skeleton (course skeleton)** — the outline produced in Stage 1: titles,
  description, tags, modules, and lesson *titles* only — no lesson bodies.
- **Lazy generation** — generating lesson bodies on demand (when first opened)
  rather than all up front. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Block** — one element of `Lesson.content`, tagged by `type`
  (`heading` / `paragraph` / `code` / `mcq`). The renderer and PDF exporter
  switch on `type`.
- **MCQ** — multiple-choice question block. `answer` is the **zero-based index**
  into `options` of the correct choice (the UI shows options 1-based, so mind
  the off-by-one).
- **Enrichment** — augmenting a generated lesson with external data; here, the
  YouTube video search. It's optional and best-effort.
- **`isEnriched`** — a `Lesson` flag set true once its body has been generated.

### LLM / generation

- **Gemini** — Google's LLM family; this app calls it via the
  `@google/generative-ai` SDK to generate the course and lessons.
- **`responseMimeType: 'application/json'`** — a Gemini generation setting that
  asks the model to emit raw JSON (no markdown fences). Encourages, but does
  **not guarantee**, valid/complete JSON. (Checkpoint 1.)
- **`responseSchema` / constrained decoding** — a stronger Gemini feature that
  constrains output to a declared schema. A *prevention* lever for Checkpoint 1.
- **Structured output** — getting machine-parseable, schema-conforming data
  (vs free text) out of an LLM.
- **Repair re-prompt** — on invalid output, sending the model its own broken
  result + errors and asking it to fix it. (Checkpoint 1.)
- **Token / output-token limit** — models cap how much they emit; hitting the
  cap mid-response is a common cause of **truncated** (unparseable) JSON.

### Resilience (Checkpoint 2)

- **Timeout** — abandoning a call that takes too long (via `AbortController`).
- **Retry with exponential backoff** — re-attempting a failed call with delays
  that grow each time (e.g. 0.5s, 1s, 2s…).
- **Jitter** — randomness added to backoff delays so many clients don't retry in
  lockstep (avoids a *thundering herd* / *retry storm*).
- **Rate limit / quota** — caps an API enforces; exceeding them returns HTTP
  **429**, often with a **`Retry-After`** header. Retrying these blindly makes
  things worse.
- **Circuit breaker** — after repeated failures, stop calling a dependency for a
  cooldown window instead of hammering it.
- **Graceful degradation** — continuing with reduced functionality when a
  non-critical dependency fails (here: a lesson with no videos).

### Frontend (Checkpoint 3)

- **SPA** — single-page application; the React app handles routing client-side
  (React Router) without full page reloads.
- **State machine / reducer** — modelling UI state as explicit states +
  transitions (`useReducer`) instead of several loose booleans.
- **SSE (Server-Sent Events)** — a one-way server→client streaming protocol
  (`EventSource`); one option for progressive rendering. Alternative: **polling**
  a job-status endpoint.
- **`AbortController` / `AbortSignal`** — the web API for cancelling in-flight
  `fetch` requests (used for both timeouts and user cancel).
- **Stale result / race condition** — when a slow async response resolves after
  it's no longer relevant (cancelled, or component unmounted) and wrongly
  updates state.

### Stack / tooling

- **Vite** — the frontend dev server + bundler. `npm run dev` serves on 5173.
- **Tailwind CSS** — utility-class styling (the `className="..."` soup).
- **Express 5** — the Node web framework serving the REST API.
- **Mongoose** — the MongoDB ODM (schemas, models, `.populate()`).
- **ODM** — Object-Document Mapper; maps JS objects ↔ MongoDB documents
  (Mongoose), analogous to an ORM for SQL.
- **`populate()`** — Mongoose's "join": replaces stored `ObjectId` references
  with the referenced documents at read time.
- **`[Mixed]`** — a Mongoose schema type for arbitrary/un-typed data; used for
  the heterogeneous `content` blocks.
- **jsPDF** — client-side PDF generation library used by the Export feature.
- **`node:test`** — Node's built-in test runner (`node --test`); no extra
  dependency. Used for the checkpoint spec tests.
- **dotenv** — loads `server/.env` into `process.env` at startup.
