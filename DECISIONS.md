# Decisions

The non-obvious choices in this codebase, the alternatives, and where the
failure modes hide. This is the "why," not the "how."

---

## 1. Two-stage lazy generation (skeleton now, lesson bodies later)

**Decision.** Submitting a topic generates only the outline (one Gemini call).
Each lesson's body + videos are generated on first open.

**Alternatives.**
- *Eager / whole-course:* generate every lesson up front. Simpler mental model,
  one "done" state.
- *Fully lazy incl. outline:* stream even the outline. Overkill for a cheap call.

**Why this one.** A course outline is small and cheap; lesson bodies are many,
slow, and costly (and the user may open only a few). Lazy generation makes the
first screen appear in ~one call instead of N, and you only pay for content
someone reads.

**Cost / failure modes.**
- More moving parts: lesson state is now "stub" vs "generated," which the UI,
  the PDF export, and `isEnriched` all have to account for.
- The course can sit half-generated indefinitely (fine here, but it's why PDF
  export says "Not generated yet" for stubs).
- This is exactly the seam **Checkpoint 3** lives in: today generation blocks on
  a spinner; progressive/streamed generation is the natural next step.

## 2. Normalized model: Course → Module → Lesson as 3 collections

**Decision.** Three collections joined by `ObjectId` refs + `.populate()`, with
back-refs (`Lesson.module`, `Module.course`).

**Alternatives.**
- *One embedded document:* the whole course (modules, lessons, content) as a
  single Mongo doc.

**Why this one.** Lazy generation needs a `Lesson` to be fetched and re-written
independently. With everything embedded, generating one lesson means rewriting
the entire course document, and large courses bump the 16 MB document limit.
Separate collections make the lesson the natural unit of work.

**Cost / failure modes.**
- Reads need `.populate()` (extra queries) — fine at this scale.
- Writes aren't atomic across collections: `createCourse`'s per-module loop can
  fail midway and leave orphan `Module`/`Lesson` docs (Risk R4 in STATUS). A
  transaction or a cleanup-on-failure would fix it; left as-is for MVP.

## 3. `Lesson.content` is an array of typed blocks, stored as `[Mixed]`

**Decision.** Content is an ordered list of `{ type, ... }` blocks
(heading/paragraph/code/mcq), persisted as schema-less `Mixed`.

**Alternatives.**
- *Markdown/HTML string:* simplest to store, but you lose structured data (MCQs
  with checkable answers, code language) and invite HTML-injection concerns.
- *A strict Mongoose sub-schema per block type:* type-safety at the DB layer.

**Why this one.** Blocks let the renderer (`LessonBlock`) and the PDF exporter
switch on `type` and treat quizzes as real data, not prose. Keeping the DB
schema loose avoids migration churn every time a block type changes — because
the *real* contract is at the generation boundary, not the database.

**Cost / failure modes.** `[Mixed]` means Mongo won't catch a malformed block;
the LLM could emit `{type:'mcq'}` with no options, or `answer` out of range.
That contract is precisely what **Checkpoint 1** hardens.

## 4. JSON via `responseMimeType`, then naive `JSON.parse`

**Decision.** Ask Gemini for `application/json` and `JSON.parse` the text.

**Alternatives.**
- *`responseSchema` (constrained decoding):* have the API enforce the shape.
- *Tool/function calling:* model fills a typed function signature.
- *Prompt-and-pray with markdown fences:* parse out of ```json blocks.

**Why this one (for now).** `responseMimeType: 'application/json'` removes the
markdown-fence problem with near-zero code, which is the right *naive* baseline.
It is deliberately not bulletproof — see Checkpoint 1.

**Where it breaks (the concrete failure).** `application/json` does **not**
guarantee a *valid, complete* document: the model can still truncate (hit the
output-token limit mid-object), omit a required field, or return `answer: 7`
for a 4-option question. A raw `JSON.parse` either throws (500 to the user) or
succeeds into a structurally-wrong object that corrupts the render. Hardening =
schema validation + one repair re-prompt + a safe fallback.

## 5. YouTube is optional and degrades to `[]`

**Decision.** No `YOUTUBE_API_KEY` → no videos, no error. Any failure → `[]`.
Lesson generation never depends on it.

**Alternatives.** Make it required (simpler code, but the app dies without a
second key and a second quota).

**Why this one.** Video enrichment is a nice-to-have on top of the core value
(the course). Coupling the critical path (generation) to a best-effort
side-quest (videos) would be fragile. Degradation keeps the happy path happy.

**Cost / failure modes.** Today the degradation is *silent* — a quota-exhausted
YouTube key looks identical to "no videos found," and there's no timeout so a
hung request still blocks the response. That nuance is **Checkpoint 2**.

## 6. PDF is rendered client-side with jsPDF (lazy-imported)

**Decision.** Export runs entirely in the browser from the already-loaded
course object; the jsPDF module is `import()`-ed on click.

**Alternatives.**
- *Server-side render (Puppeteer/headless Chrome):* pixel-perfect, but a heavy
  dependency, a render farm concern, and a new server endpoint.
- *Static `import` of jsPDF:* simpler, but jsPDF drags in `html2canvas` +
  `dompurify` (~400 KB), bloating the initial bundle for a feature most page
  loads never use.

**Why this one.** CoursePage already has the full populated course, so a PDF
needs no extra data or server work. Lazy-importing keeps the main bundle ~76 KB
gzipped and pays the 130 KB PDF cost only when the user actually exports.

**Cost / failure modes.** jsPDF text layout is manual (cursor + pagination in
`pdf.js`); very long unbroken strings or exotic block types need handling. Good
enough for the MVP, not a typesetting engine.

## 7. Tests use Node's built-in runner (`node:test`), zero deps

**Decision.** Both packages test with `node --test`; the checkpoint specs are
skipped.

**Alternatives.** Jest / Vitest / Mocha — richer, but each adds a dependency
tree and config, and Vitest for the client would pull jsdom + testing-library
for what is currently four pure-logic specs.

**Why this one.** Keeps the "minimal new dependencies" promise. The specs exist
to *describe the target behaviour* of the checkpoints; a built-in runner is
plenty. Reach for Vitest if/when Checkpoint 3 grows real component tests.

---

## Where the failure modes concentrate

If you're hunting for the riskiest seams, look here (and note they map cleanly
onto the three checkpoints):

1. **The LLM boundary** (`gemini.js`) — malformed/partial JSON, wrong shapes.
   → Checkpoint 1.
2. **The external calls** (`gemini.js`, `youtube.js`) — timeouts, quota, retries,
   silent degradation. → Checkpoint 2.
3. **The generation UX** (`LessonPage.jsx`) — blocking spinner, no cancel, error
   wipes state. → Checkpoint 3.
4. **Non-atomic writes** (`courseController.js` loop) — orphan docs on partial
   failure. (Not a checkpoint; noted in STATUS R4.)
5. **No fail-fast on DB** (`server.js`) — server "up" while every query 500s.
   (STATUS R1.)
