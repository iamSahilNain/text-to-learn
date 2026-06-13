# Annotated tour

Read the system like a story. Follow the order below; each step says what to
open and what it hands off to next. File references are clickable
(`path:line`).

---

## 1. The server boots

**`server/server.js`** — the whole backend wiring in 27 lines.

- [server.js:10-11](server/server.js#L10) — `cors()` (open to all origins) and
  `express.json()` body parsing.
- [server.js:13](server/server.js#L13) — `mongoose.connect(MONGO_URI)`. Note
  there's no fail-fast: if Mongo never connects, the server still listens and
  every DB query later times out. (Risk R1 in [STATUS.md](STATUS.md).)
- [server.js:17-18](server/server.js#L17) — two route groups mounted:
  `/api/courses` and `/api/lessons`. **Routes are mounted before the `/` and
  any catch-all**, which matters in Express 5.
- [server.js:25](server/server.js#L25) — `app.listen(PORT)`.

Two routers hang off this: course routes and lesson routes.

## 2. Generating a course (Stage 1 — the skeleton)

**`server/routes/courseRoutes.js`** — maps URLs to controller functions.

- [courseRoutes.js:5-7](server/routes/courseRoutes.js#L5) — `POST /generate`,
  `GET /`, `GET /:id`. The specific `/generate` is declared before `/:id` so it
  isn't swallowed by the param route.

**`server/controllers/courseController.js`** — the meat of Stage 1.

- [courseController.js:15](server/controllers/courseController.js#L15) — calls
  `generateCourse(topic)`. This is the single Gemini call that produces the
  outline.
- [courseController.js:18-23](server/controllers/courseController.js#L18) —
  creates the `Course` document.
- [courseController.js:26-48](server/controllers/courseController.js#L26) — the
  per-module loop: `Lesson.insertMany` creates lesson **stubs** (empty
  `content`), `Module.create` wires the lesson ids, then `Lesson.updateMany`
  back-fills each lesson's `module` ref. **This loop is not atomic** — a failure
  partway leaves orphan docs (Risk R4).
- [courseController.js:53-57](server/controllers/courseController.js#L53) —
  re-reads the course with nested `.populate()` (modules → lessons) and returns
  it.

Where does `generateCourse` come from? →

**`server/services/gemini.js`** — the LLM boundary.

- [gemini.js:13-28](server/services/gemini.js#L13) — `getModel()` lazily builds
  the client so a missing key fails loudly *at use*, not at boot, and sets
  `responseMimeType: 'application/json'`.
- [gemini.js:32-36](server/services/gemini.js#L32) — **`// LEARNING CHECKPOINT
  #1`**. The naive `JSON.parse(text)`: trust the model, throw on bad JSON. No
  schema, no repair, no fallback. This is your first thing to harden.
- [gemini.js:38](server/services/gemini.js#L38) `generateCourse` and
  [gemini.js:62](server/services/gemini.js#L62) `generateLesson` — the two
  prompts, each specifying the exact JSON shape it expects back.

## 3. Reading a course

**`client/src/pages/CoursePage.jsx`**

- [CoursePage.jsx:18](client/src/pages/CoursePage.jsx#L18) — `GET
  /api/courses/:id` (served by
  [courseController.js:75](server/controllers/courseController.js#L75), fully
  populated).
- [CoursePage.jsx:23-32](client/src/pages/CoursePage.jsx#L23) — **Export PDF**
  button → `handleExport`, which **lazy-imports** the PDF module (jsPDF is
  heavy) and renders client-side. → see step 6.

## 4. Generating a lesson (Stage 2 — lazy body + enrichment)

**`server/routes/lessonRoutes.js`**

- [lessonRoutes.js:9-16](server/routes/lessonRoutes.js#L9) — `GET /:id` fetches
  one lesson.
- [lessonRoutes.js:19](server/routes/lessonRoutes.js#L19) — `POST /:id/generate`
  is the heart of Stage 2.
- [lessonRoutes.js:23-25](server/routes/lessonRoutes.js#L23) — walks up the
  graph (lesson → module → course) to get the titles the prompt needs.
- [lessonRoutes.js:27](server/routes/lessonRoutes.js#L27) — `generateLesson(...)`
  (Gemini, again through Checkpoint #1's parser).
- [lessonRoutes.js:30-34](server/routes/lessonRoutes.js#L30) — saves
  `objectives` + `content`, then enriches with
  `searchVideos(...)`. The video call **cannot break generation** (see next).

**`server/services/youtube.js`** — the optional, degradable integration.

- [youtube.js:23-24](server/services/youtube.js#L23) — no key → return `[]`.
  This is why YouTube is optional.
- [youtube.js:35-48](server/services/youtube.js#L35) — **`// LEARNING
  CHECKPOINT #2`**. One `fetch`, basic try/catch, any failure → `[]`. No
  timeout, no retry/backoff, no quota awareness. Your second thing to harden.

## 5. Rendering a lesson

**`client/src/pages/LessonPage.jsx`**

- [LessonPage.jsx:11-16](client/src/pages/LessonPage.jsx#L11) — load the lesson.
- [LessonPage.jsx:18-40](client/src/pages/LessonPage.jsx#L18) — `handleGenerate`
  with **`// LEARNING CHECKPOINT #3`**: a single `generating` boolean, blocking
  spinner, render-all-at-once. Your third thing to harden (progressive render +
  cancel + error states).
- [LessonPage.jsx:56](client/src/pages/LessonPage.jsx#L56) — objectives panel.
- [LessonPage.jsx:74](client/src/pages/LessonPage.jsx#L74) — the video grid.
- [LessonPage.jsx:113](client/src/pages/LessonPage.jsx#L113) — `LessonBlock`
  switch (heading/paragraph/code/mcq), and
  [LessonPage.jsx:132](client/src/pages/LessonPage.jsx#L132) `McqBlock`, the
  interactive quiz (pick → correct/incorrect + explanation).

## 6. Exporting to PDF

**`client/src/pdf.js`**

- [pdf.js:6](client/src/pdf.js#L6) — `exportCourseToPdf(course)` walks the
  populated course (modules → lessons → blocks), paginating as it goes.
- [pdf.js:53-55](client/src/pdf.js#L53) — lessons with no `content` are printed
  as "Not generated yet" — this is the "export what's generated" rule.
- [pdf.js:79](client/src/pdf.js#L79) — `writeBlock` renders each content block
  type into the PDF (the MCQ marks the correct option with `✓`).

## 7. Where the checkpoints live (quick index)

| # | Marker | File |
|---|---|---|
| 1 | LLM JSON parse | [gemini.js:32](server/services/gemini.js#L32) |
| 2 | YouTube single call | [youtube.js:35](server/services/youtube.js#L35) |
| 3 | Blocking generation | [LessonPage.jsx:20](client/src/pages/LessonPage.jsx#L20) |

Now read [LEARNING.md](LEARNING.md) for what to build at each.
