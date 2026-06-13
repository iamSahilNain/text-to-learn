# Learning map

A single sequenced path to learn this codebase well enough to **whiteboard it
cold**. This is a *test-yourself* map, not a tutorial — it deliberately holds
back answers.

**How to use a node:**
1. Read the **RECALL PROMPT** and answer it out loud / on paper **from memory,
   before opening anything.**
2. Open the **WHERE TO VERIFY** pointers and check your answer. (These are
   pointers, not answers — you still have to read the code.)
3. Self-grade against the **PASS BAR**. If you missed an item, redo the recall
   prompt tomorrow.

This map links to the deep docs instead of repeating them:
[ANNOTATED.md](ANNOTATED.md) (line-by-line tour),
[LEARNING.md](LEARNING.md) (the checkpoints in depth),
[ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md).

**Orientation (free):** two processes — a React/Vite SPA (`client`, :5173) and
an Express/Mongoose API (`server`, :3001) that owns the Gemini and YouTube
integrations. Hold that in your head; every node sits inside it.

**Dependency order:** 1 → 2 build the flow; 3 explains why the flow is split;
4 is the data shape that makes the split work; 5 → 7 are where it's fragile.

---

## Node 1 — Skeleton generation path  ★ MUST DEFEND
*Covers area (1a). The "type a topic, see an outline" half of the flow.*

**RECALL PROMPT.** Draw what happens from *"user clicks Generate Course"* to
*"the course outline renders."* Name: the client call, the route, the **one**
external call and what it returns, every collection written and in what order,
and what the response contains that lets the next screen render without another
generation call.

**WHERE TO VERIFY.**
[Home.jsx:15](client/src/pages/Home.jsx#L15) ·
[courseRoutes.js:5](server/routes/courseRoutes.js#L5) ·
[courseController.js:15](server/controllers/courseController.js#L15),
[:18](server/controllers/courseController.js#L18),
[:26-50](server/controllers/courseController.js#L26),
[:53](server/controllers/courseController.js#L53) ·
[gemini.js:38](server/services/gemini.js#L38) · or skim
[ANNOTATED.md](ANNOTATED.md) §2.

**PASS BAR.** A complete answer:
- names `POST /api/courses/generate` → `createCourse`;
- says Gemini is called **once** and returns **titles only** (no lesson bodies);
- lists the three writes in order — `Course.create`, then per module
  `Lesson.insertMany` (empty `content` stubs) → `Module.create` → `Lesson.updateMany`
  to back-fill the `module` ref;
- states the response is the **populated** course (modules → lessons), which is
  why CoursePage needs no further generation call to draw the outline;
- bonus: flags that the per-module loop is **not atomic** (orphans on partial failure).

---

## Node 2 — Lazy lesson generation + enrichment path  ★ MUST DEFEND
*Covers area (1b). The "click a lesson, get content + videos" half — the most
likely interview whiteboard prompt.*

**RECALL PROMPT.** Draw what happens from *"user opens a lesson with no content
and clicks Generate"* to *"content + videos on screen."* Name the route, the two
external calls and their **order**, what gets written to the lesson, what
happens if the YouTube call fails, and where the final render decides between
the four block types.

**WHERE TO VERIFY.**
[LessonPage.jsx:18-40](client/src/pages/LessonPage.jsx#L18) (generate),
[:113](client/src/pages/LessonPage.jsx#L113) (block switch),
[:132](client/src/pages/LessonPage.jsx#L132) (MCQ) ·
[lessonRoutes.js:19](server/routes/lessonRoutes.js#L19),
[:23-25](server/routes/lessonRoutes.js#L23),
[:30-37](server/routes/lessonRoutes.js#L30) ·
[gemini.js:62](server/services/gemini.js#L62) ·
[youtube.js:23](server/services/youtube.js#L23) · or [ANNOTATED.md](ANNOTATED.md) §4-5.

**PASS BAR.** A complete answer:
- names `POST /api/lessons/:id/generate`;
- explains it first walks **lesson → module → course** to build the prompt
  context (titles);
- order: **Gemini for the body, then YouTube for videos**; both `objectives`
  and `content` and `videos` saved on the lesson, `isEnriched` set;
- states YouTube failure (or no key) yields `[]` and **does not break**
  generation;
- names the render: a `type` switch over `heading | paragraph | code | mcq`, MCQ
  being interactive (answer index is **0-based**).

---

## Node 3 — Two-stage design (skeleton vs lazy body) & why not eager  ★ MUST DEFEND
*Covers area (2). The single most important "why" — interviewers push on it.*

**RECALL PROMPT.** Why is generation split into a cheap skeleton call now and
expensive lesson calls later, instead of generating the whole course (all lesson
bodies) on submit? Give the concrete win, two costs the split introduces, and
which checkpoint that design seam leads directly into.

**WHERE TO VERIFY.** Evidence in code: skeleton-only at
[courseController.js:15](server/controllers/courseController.js#L15) (Gemini once,
titles only) vs body-on-demand at
[lessonRoutes.js:19](server/routes/lessonRoutes.js#L19). Reasoning:
[DECISIONS.md](DECISIONS.md) §1, [ARCHITECTURE.md](ARCHITECTURE.md) "two-stage".

**PASS BAR.** A complete answer:
- the win: first screen appears after **1 call, not N**; you only pay (latency +
  tokens + money) for lessons actually opened;
- cost 1: extra state — every lesson is "stub" vs "generated," which the UI, PDF
  export, and `isEnriched` must all handle;
- cost 2: a course can sit half-generated (why PDF prints "Not generated yet");
- names that the blocking-spinner generation seam is exactly **Checkpoint 3**.

---

## Node 4 — Mongo data model & why it's shaped that way  ★ MUST DEFEND
*Covers area (3). You can't whiteboard the writes (Node 1) without this.*

**RECALL PROMPT.** Sketch the three collections and their relationships. Why
three normalized collections with `ObjectId` refs + `populate`, instead of one
embedded course document? Why does `Lesson` carry **back-refs** (`module`),
plus `objectives` and `videos`, and why is `content` typed as `[Mixed]` rather
than a strict per-block schema?

**WHERE TO VERIFY.**
[Lesson.js:11-17](server/models/Lesson.js#L11) (objectives/content/videos/module),
[Course.js](server/models/Course.js), [Module.js](server/models/Module.js) ·
populate at [courseController.js:53](server/controllers/courseController.js#L53) ·
reasoning in [ARCHITECTURE.md](ARCHITECTURE.md) "Why this shape" + [DECISIONS.md](DECISIONS.md) §2-3.

**PASS BAR.** A complete answer:
- `Course → Module → Lesson`, parent holds an ordered array of child refs;
- normalized because the **lesson is the unit of lazy (re)generation** — embed
  everything and you rewrite the whole course doc per lesson and risk the 16 MB
  doc limit;
- back-refs (`Lesson.module`, `Module.course`) make the **upward walk** in Node 2
  cheap;
- `objectives`/`videos` are lesson-owned outputs of generation/enrichment
  (`videos` embedded as a sub-doc, not referenced — never queried alone);
- `[Mixed]` keeps the block contract at the **generation boundary**, not the DB —
  which is precisely why **Checkpoint 1** matters (Mongo won't catch a bad block).

---

## Node 5 — Checkpoint 1: LLM structured-output contract  ★ MUST DEFEND
*Concept only — no solution. The most reusable LLM-engineering talking point.*

**RECALL PROMPT.** The course/lesson generators `JSON.parse` Gemini's response.
Setting `responseMimeType: 'application/json'` is on — so why is parsing still
unsafe? Give **two distinct** concrete failure cases (one that throws, one that
silently succeeds-but-wrong), the three-move shape of the fix, and its tradeoff.
**Do not describe an implementation.**

**WHERE TO VERIFY.** Marker at
[gemini.js:32](server/services/gemini.js#L32) · concept + hints in
[LEARNING.md](LEARNING.md) "Checkpoint 1" · spec `server/tests/checkpoint1.gemini.test.js`.

**PASS BAR.** A complete answer:
- failure A (throws): **truncation** at the output-token cap → `SyntaxError` → 500;
- failure B (silent): **valid JSON, wrong shape** — e.g. empty `modules`, or an
  `mcq` with `answer` out of range — parses fine, corrupts the render;
- the fix shape, named at concept level only: **validate → one repair re-prompt →
  safe fallback** (never throw raw to the caller);
- tradeoff: the repair adds **latency + a second call (cost)** and code
  complexity; you cap it at one attempt so a bad model can't loop you forever.

---

## Node 6 — Checkpoint 2: external-API resilience  ★ MUST DEFEND
*Concept only — no solution. Distributed-systems credibility in an interview.*

**RECALL PROMPT.** Both external calls are single attempts. Name the failure each
missing protection causes: (a) no timeout, (b) no backoff on a transient 5xx,
(c) treating a **429/quota** like a normal error, (d) silent YouTube
degradation. Then state, at concept level, what hardening each needs and *why
retrying a 429 the same way as a 503 is actively harmful.* **No implementation.**

**WHERE TO VERIFY.** Marker at
[youtube.js:35](server/services/youtube.js#L35) (and the Gemini call it
generalizes to) · concept + hints in [LEARNING.md](LEARNING.md) "Checkpoint 2" ·
spec `server/tests/checkpoint2.resilience.test.js`.

**PASS BAR.** A complete answer:
- (a) no timeout → the request **hangs**, tying up a worker and the user's spinner
  forever; fix = timeout via `AbortController`;
- (b) transient 5xx fails a request a **retry would have saved**; fix = retry with
  **exponential backoff + jitter** (jitter ⇒ no synchronized retry storm);
- (c) blindly retrying a 429 **hammers an API already saying stop** and can
  extend the limit; fix = distinct policy (honor `Retry-After` / back off hard),
  i.e. transient vs quota are different classes;
- (d) today YouTube failure and "no results" are **indistinguishable** (`[]`); fix
  = make degradation observable so generation can still succeed *and* report it;
- tradeoff: resilience adds latency, complexity, and the risk of hiding real
  errors — build it as **one reusable wrapper**, not per-call copy-paste.

---

## Node 7 — Checkpoint 3: progressive generation UX  ☆ NICE TO HAVE
*Concept only — no solution. Worth defending, but the backend nodes carry more
interview weight.*

**RECALL PROMPT.** `handleGenerate` uses one `generating` boolean and blocks on a
spinner until the whole lesson returns. Name three concrete problems with that,
the state-modelling change that fixes the root cause, the two server shapes that
enable progressive arrival, and the subtle correctness bug `cancel` introduces.

**WHERE TO VERIFY.** Marker at
[LessonPage.jsx:20](client/src/pages/LessonPage.jsx#L20) · concept + hints in
[LEARNING.md](LEARNING.md) "Checkpoint 3" · spec
`client/tests/progressiveGeneration.test.js`.

**PASS BAR.** A complete answer:
- problems: all-or-nothing latency with zero feedback; no cancel; an error after
  partial progress **wipes everything** with no retry;
- root-cause fix: replace boolean soup with an explicit **state machine /
  reducer** (states + events: START / chunk-received / DONE / ERROR / CANCEL);
- progressive arrival needs **streaming (SSE / ReadableStream)** *or* **polling a
  job status** — name both as options;
- the cancel bug: a **stale result** arriving after cancel/unmount must be
  **ignored** (request id / abort), or it paints content the user abandoned.

---

## Paths through the map

### 30-minute pass — "can I whiteboard the system?"
Do **Node 1 → Node 2 → Node 4**, recall-first, in that order. That's the full
data flow plus the data model behind the writes — enough to draw the system end
to end. Then state Node 3's one-line "why two-stage" from memory. Skip the
checkpoints. If you can do Nodes 1, 2, 4 cold, you can hold a whiteboard.

### 2-hour pass — "can I defend the design and the hard parts?"
1. **(0:00–0:35)** Nodes 1 → 2 → 3 → 4, recall-first, self-graded against each
   PASS BAR. Redo any node you failed.
2. **(0:35–1:25)** Nodes 5 → 6 (the must-defend checkpoints). For each: answer
   the recall prompt cold, then open the spec test and the
   [LEARNING.md](LEARNING.md) section and confirm you named the failure case, the
   hardening *shape*, and the tradeoff — without sliding into an implementation.
3. **(1:25–1:50)** Node 7 once, lighter.
4. **(1:50–2:00)** Re-draw the **whole** flow (Nodes 1+2) on one page from memory,
   annotating each external call with the Node 5/6 failure it's exposed to. If
   that annotated diagram comes out clean, you're interview-ready.
