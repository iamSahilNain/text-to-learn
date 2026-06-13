# Learning checkpoints

Three parts of this app are intentionally built in their simplest naive form.
Each keeps the app working, is marked in code with `// LEARNING CHECKPOINT #n`,
and has a **skipped spec test** describing the target. Your job is to build the
hardened version.

**How to work a checkpoint:** open the marker → read the spec test → remove its
`{ skip: ... }` → make it pass (you'll likely add more tests). No solutions live
in this repo, on purpose. Hints below are **graded**: read only as far as you
need.

| # | Marker | Spec test |
|---|---|---|
| 1 | [server/services/gemini.js:32](server/services/gemini.js#L32) | `server/tests/checkpoint1.gemini.test.js` |
| 2 | [server/services/youtube.js:35](server/services/youtube.js#L35) | `server/tests/checkpoint2.resilience.test.js` |
| 3 | [client/src/pages/LessonPage.jsx:20](client/src/pages/LessonPage.jsx#L20) | `client/tests/progressiveGeneration.test.js` |

---

## Checkpoint 1 — LLM structured-output contract & repair

### The problem
`generateJSON` does `JSON.parse(text)` and trusts whatever comes back. Build a
**strict contract** for the course (and lesson) objects: validate the parsed
output, and when it's invalid or incomplete, attempt **one** repair re-prompt,
and if that still fails, return a **safe fallback** instead of throwing.

### Why naive is insufficient (concrete failure)
`responseMimeType: 'application/json'` makes the model *tend* to emit JSON — it
does **not** guarantee valid or complete JSON. Real failures you will hit:

- **Truncation.** A big course hits the output-token cap mid-object. `JSON.parse`
  throws `SyntaxError`, the controller returns 500, the user sees "Failed to
  generate course." One bad roll of the dice = a broken request.
- **Wrong shape that still parses.** The model returns
  `{ "title": "...", "modules": [] }` (no lessons), or an `mcq` with
  `answer: 5` for a 4-option list. `JSON.parse` is happy; Mongo (`[Mixed]`) is
  happy; the UI renders an empty course or an unanswerable quiz. A silent-but-
  wrong result is worse than an error.

### Graded hints
1. Separate the two concerns: *is it parseable?* vs *is it the right shape?*
   You need a validation step that runs **after** parse and returns a typed
   result, not a thrown exception, so the caller can decide what to do.
2. "Repair" doesn't mean hand-patching JSON. It means: feed the model back its
   own broken output plus the validation errors and the schema, and ask it to
   return corrected JSON — **exactly once**, so a stubborn model can't loop you
   forever. Think about what your fallback is if attempt #2 also fails (a
   minimal valid course is renderable; a 500 is not).
3. Decide *where* this lives. The naive parse is the single choke point at
   [gemini.js:35](server/services/gemini.js#L35) — everything funnels through
   `generateJSON`, which is a hint about where validation + retry belong.

### Read / keywords
- Gemini structured output: "controlled generation", "responseSchema",
  `responseMimeType` (Google AI docs). Notice constrained decoding is one
  *prevention* lever — you still want validation as defense in depth.
- Schema validation in JS: **Zod**, **Ajv** / JSON Schema. (You can also
  hand-roll for this small shape.)
- Patterns: "LLM output validation", "self-healing / re-prompt on validation
  error", "graceful degradation vs fail-fast".

---

## Checkpoint 2 — External-API resilience (Gemini + YouTube)

### The problem
Both external calls are a single attempt. Build resilience: a **timeout**,
**retry with exponential backoff + jitter**, **rate-limit/quota handling**, and
deliberate **graceful degradation** for YouTube so a failed enrichment never
sinks a successful generation.

### Why naive is insufficient (concrete failure)
- **No timeout.** `fetch`/the SDK can hang on a slow network. Your
  `POST /lessons/:id/generate` hangs with it — the user's spinner spins forever,
  a server worker is tied up, nothing ever resolves.
- **No backoff.** A transient 503 from Gemini fails the whole request even
  though a retry 500 ms later would have worked. Conversely, retrying a **429
  quota** error *immediately and repeatedly* is the worst thing you can do — you
  hammer an API that's already telling you to stop, and may extend the ban.
- **Silent degradation.** Today YouTube failure and "no results" both yield
  `[]`. You can't tell a quota-exhausted key from a topic with no videos, so you
  can't surface "videos unavailable, try later" or decide whether to retry.

### Graded hints
1. Two different failure classes need two different policies. A transient
   network/5xx error *wants* a retry; a 429/quota or a 4xx *does not* (or wants
   a long, header-driven wait). What information distinguishes them, and where
   do you read it? (Hint: HTTP status, and a response header that starts with
   `Retry-`.)
2. "Backoff with jitter": the delay should *grow* between attempts (so you're
   not synchronised with every other client retrying at once) **and** include
   randomness (so a thundering herd doesn't retry in lockstep). Why would
   constant or purely-exponential-no-jitter delays make an outage worse?
3. Build the resilience as a **reusable wrapper** around any async call, not
   copy-pasted into Gemini and YouTube. Timeout is its own concern — look at
   `AbortController` / `AbortSignal.timeout`. For degradation, ask: what should
   the lesson record *say* when enrichment failed (vs genuinely had no videos)?
   The naive code throws that information away.

### Read / keywords
- "exponential backoff and jitter" (AWS Architecture Blog — the canonical
  "Full Jitter" write-up), "retry storm / thundering herd".
- "circuit breaker pattern" (when an API is down, stop calling it for a while).
- `AbortController`, `AbortSignal.timeout()` (MDN). HTTP `429`, `Retry-After`.
- YouTube Data API **quota** model (units per call, daily cap) — why blind
  retries are especially costly there.

---

## Checkpoint 3 — Progressive generation UX + frontend state

### The problem
`handleGenerate` flips one `generating` boolean and blocks behind a spinner
until the whole lesson returns, then renders it all at once. Build a
**progressive** experience: render content as it streams/polls in, support
**cancel**, and handle a **mid-generation error** without losing what already
arrived.

### Why naive is insufficient (concrete failure)
- **All-or-nothing latency.** A multi-block lesson (plus a YouTube round-trip)
  can take many seconds. The user stares at a spinner with zero feedback and no
  way to tell a slow success from a hang.
- **No cancel.** Click Generate, change your mind or navigate away — the request
  keeps running, and a late response can `setState` on a stale view (React will
  warn, or you paint content the user no longer wants).
- **Error nukes everything.** If generation fails after some modules/blocks were
  produced, the naive `catch` just clears the spinner; the user gets nothing and
  no retry affordance, even if 80% succeeded.

### Graded hints
1. Replace the single boolean with an explicit **state machine**: think about
   the legal states (`idle → generating → done`, plus `error`) and the events
   that move between them (`START`, `CHUNK/MODULE_RECEIVED`, `DONE`, `ERROR`,
   `CANCEL`). The spec test sketches a `generationReducer` shape — a `useReducer`
   is a natural home. Why is a reducer easier to reason about here than five
   `useState`s?
2. Progressive rendering needs the data to *arrive in pieces*. Two server
   shapes enable that: **streaming** (Server-Sent Events / a chunked response /
   `ReadableStream` on the client) or **polling** (kick off a job, poll a status
   endpoint). Sketch the server change each implies — the lazy per-lesson design
   already leans toward generating module-by-module.
3. Cancel + stale-result safety: `AbortController` cancels the request, but you
   also need your reducer to **ignore results that arrive after a cancel** (a
   request id or a generation token is one way). What happens to an in-flight
   response when the component unmounts — and how does the effect cleanup help?

### Read / keywords
- `useReducer`, "state machine" / "statechart" (XState is worth reading even if
  you hand-roll), "finite states beat boolean soup".
- Streaming to the browser: **Server-Sent Events (`EventSource`)**, the
  `fetch` + `ReadableStream`/`getReader()` pattern, vs **polling a job status**.
- `AbortController` in React effects; "cancel fetch on unmount"; "ignore stale
  async results" / "race condition in useEffect".

---

When a checkpoint passes its (un-skipped) spec and the app still runs end to
end, you've hardened that seam. Tackle them in order — each builds intuition for
the next.
