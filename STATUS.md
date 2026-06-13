# STATUS — Text-to-Learn (Phase 0 Audit)

_Audit date: 2026-06-13. Nothing in the codebase was changed to produce this report (the working tree is clean). Findings are verified against the actual code, not the project brief._

---

## 1. What this project actually is

A two-service app for generating AI courses:

- **`client/`** — React 19 + Vite 8 + Tailwind 4 SPA. Three routes: Home (enter topic), CoursePage (module/lesson outline), LessonPage (lesson content).
- **`server/`** — Node + Express 5 + Mongoose 9 (MongoDB Atlas). REST API for courses and lessons, plus a `services/gemini.js` "AI" module.

There is **no root `package.json`** — the two halves are independent npm projects you install and run separately.

### Generation is a two-stage, lazy flow (this is a real design, and it's sensible)

1. **Course skeleton** is generated immediately on topic submit: title, description, tags, and modules containing only lesson *titles* (no lesson body).
2. **Lesson content** is generated **on demand**, per lesson, the first time you open a lesson and click "Generate Lesson Content."

So the course outline is cheap/instant; the expensive content generation is deferred until a lesson is actually opened.

---

## 2. Repo map

```
text-to-learn/
├── .gitignore                 # node_modules, .env  (✓ .env is ignored & untracked)
├── client/                    # React + Vite SPA
│   ├── package.json           # scripts: dev, build, lint, preview
│   ├── vite.config.js         # bare react plugin; no proxy, no env wiring
│   ├── index.html
│   └── src/
│       ├── main.jsx           # React root (StrictMode)
│       ├── App.jsx            # BrowserRouter + 3 routes
│       ├── index.css          # @import "tailwindcss"
│       └── pages/
│           ├── Home.jsx       # topic input → POST /api/courses/generate
│           ├── CoursePage.jsx # GET /api/courses/:id → render modules+lessons
│           └── LessonPage.jsx # GET lesson; POST .../generate; render blocks
└── server/                    # Express API
    ├── .env                   # MONGO_URI, GEMINI_API_KEY  (REAL creds, untracked)
    ├── package.json           # scripts: only the default failing "test"
    ├── server.js              # app bootstrap, mongoose.connect, route mounting
    ├── models/
    │   ├── Course.js          # title, description, tags[], modules[ref]
    │   ├── Module.js          # title, course[ref], lessons[ref]
    │   └── Lesson.js          # title, content[Mixed], isEnriched, module[ref]
    ├── routes/
    │   ├── courseRoutes.js    # POST /generate, GET /, GET /:id
    │   └── lessonRoutes.js    # GET /:id, POST /:id/generate
    ├── controllers/
    │   └── courseController.js# createCourse, getCourses, getCourse
    └── services/
        └── gemini.js          # ⚠ MOCK ONLY — no real API call
```

### npm scripts

| Project | Script | Command |
|---|---|---|
| client | `dev` | `vite` |
| client | `build` | `vite build` |
| client | `lint` | `eslint .` |
| client | `preview` | `vite preview` |
| server | `test` | `echo "Error: no test specified" && exit 1` (placeholder) |

**The server has no `start` or `dev` script.** It can only be launched with `node server.js`. There is no nodemon/watch.

### Dependencies

- **client:** `react`/`react-dom` 19, `react-router-dom` 7, `tailwindcss` 4 (+ `@tailwindcss/vite`, `@tailwindcss/postcss`), `vite` 8, eslint toolchain. **No `jspdf`** (PDF export is not present). No HTTP client — uses native `fetch`.
- **server:** `@google/generative-ai` 0.24.1 **(installed but never imported)**, `express` 5, `mongoose` 9, `mongodb` 7, `cors`, `dotenv`. **No YouTube/googleapis dependency.**

These are bleeding-edge majors (Express 5, Mongoose 9, React 19, Node 25 locally). Nothing broke in audit, but it's worth knowing.

### Environment variables

| Var | Used in code? | In `server/.env`? | Notes |
|---|---|---|---|
| `MONGO_URI` | ✓ `server.js:13` | ✓ | Points at a MongoDB Atlas `mongodb+srv` cluster |
| `PORT` | ✓ `server.js:24` (default 3001) | ✗ | Falls back to 3001 |
| `GEMINI_API_KEY` | ✗ **never read** | ✓ | Present but unused (gemini.js is mocked) |
| (YouTube key) | ✗ | ✗ | Not present anywhere yet |
| (client API URL) | ✗ | n/a | Client **hardcodes** `http://localhost:3001` in 3 files |

There is **no `.env.example`**.

---

## 3. Data model (Mongoose)

Normalized across three collections joined by ObjectId refs + `.populate()`:

- **Course** — `title*`, `description`, `tags: [String]`, `modules: [→Module]`, timestamps.
- **Module** — `title*`, `course: →Course*`, `lessons: [→Lesson]`, timestamps.
- **Lesson** — `title*`, `content: [Mixed]*`, `isEnriched: Boolean`, `module: →Lesson's parent`, timestamps.

`Lesson.content` is an array of heterogeneous **blocks**, each a `{ type, ... }` object. Observed types (from the mock + renderer): `heading`, `paragraph`, `code` (with `language`), `mcq` (`question`, `options[]`, `answer` index, `explanation`).

**Gaps in the model vs. the brief:**
- **No `videos`/enrichment field** on Lesson (or Module). YouTube attachment is not modeled at all. `isEnriched` currently just means "lesson body has been generated," not "videos attached."
- The mock `generateLesson` returns an `objectives` array, but the save path (`lessonRoutes.js:28`) only persists `content` — **objectives are silently dropped** and never rendered.

---

## 4. Request → generation → render → export flow (as it exists today)

```
Home.jsx
  └─ POST /api/courses/generate {topic}
       └─ courseController.createCourse
            ├─ generateCourse(topic)        ← MOCK: fixed 3 modules, lesson TITLES only
            ├─ Course.create(...)
            ├─ for each module: Lesson.insertMany (content:[]) → Module.create → Lesson.updateMany(module ref)
            └─ return populated Course
  └─ navigate(/course/:id)

CoursePage.jsx
  └─ GET /api/courses/:id  (modules→lessons populated)
       └─ render module cards + lesson buttons

LessonPage.jsx
  └─ GET /api/lessons/:id
       └─ if content empty: "Generate Lesson Content" button
            └─ POST /api/lessons/:id/generate
                 └─ generateLesson(...)      ← MOCK: fixed heading/paragraph/code/mcq blocks
                 └─ save content, isEnriched=true
       └─ render blocks (heading | paragraph | code | mcq)
```

There is **no render-of-videos** step and **no export step** — those parts of the brief don't exist yet.

---

## 5. What works / half-built / broken / missing

### ✅ Works (verified)
- Client **builds** cleanly (`vite build` → 27 modules, ~370ms) and the dev server is configured.
- Express server **boots** and serves `GET /` (`{"message":"Text-to-Learn backend is running"}`).
- Routes are wired correctly; route order is fine (specific before `/:id`).
- Mongoose models + populate logic are internally consistent.
- The full two-stage UI flow is coherent **with mock data** (assuming the DB connects).

### 🟡 Half-built
- **Lesson rendering**: `mcq` blocks render the question + options but there's **no answer selection/checking** and the `explanation` is **never shown** — it's dead data today.
- **`isEnriched`** flag exists but only tracks content generation, not the video enrichment the brief wants.

### ❌ Broken / unverified
- **MongoDB connection could not be verified from this environment.** The server booted but **never logged `MongoDB connected`**, and `GET /api/courses` timed out into `{"error":"Failed to fetch courses"}`. No `MongoDB error:` was logged either — the connection promise just hangs, and Mongoose query buffering masks it. Most likely cause: **Atlas IP allowlist** (this machine's IP isn't whitelisted) or **sandboxed outbound network**. Needs confirmation on your machine / in Atlas → Network Access.

### 🚫 Missing entirely (vs. the brief's MVP bar)
1. **Real Gemini generation** — `gemini.js` is a hardcoded mock (comment: "replace with real Gemini call after quota resets"). `GEMINI_API_KEY` is unused.
2. **YouTube enrichment** — no dependency, no model field, no service, no UI.
3. **PDF export (jsPDF)** — no dependency, no button, no handler.
4. **Server run scripts** — no `start`/`dev`.
5. **`.env.example`** — absent.

---

## 6. Bugs & risks (beyond the missing features)

| # | Severity | Issue | Where |
|---|---|---|---|
| R1 | High | Mongo connection failure is silent; server stays "up" while every request 500s. No fail-fast, no health signal. | `server.js:13-15` |
| R2 | High | **Real secrets live in `server/.env`** (Atlas creds). Correctly gitignored & untracked today — but `.env.example` must use placeholders, and these must never be committed. | `server/.env` |
| R3 | Med | Client **hardcodes `http://localhost:3001`** in 3 places — breaks in any non-local setup; no `VITE_API_URL`. | `Home.jsx:15`, `CoursePage.jsx:11`, `LessonPage.jsx:12,21` |
| R4 | Med | `createCourse` does many sequential, **non-atomic** writes in a loop; a mid-loop failure leaves orphaned Course/Module/Lesson docs. | `courseController.js:18-50` |
| R5 | Med | No input validation/limits on `topic`; no rate limiting. Matters once real Gemini/YouTube calls cost quota & money. | `courseController.js:9-12` |
| R6 | Low | `objectives` generated but never persisted or rendered (dead output). | `lessonRoutes.js:28` |
| R7 | Low | MCQ `answer` is a **0-based index** (mock uses `3`) but options render **1-based**; future grader must not assume they match the label. | `gemini.js:47`, `LessonPage.jsx:88` |
| R8 | Low | CORS open to all origins (fine for local dev; tighten for deploy). | `server.js:10` |
| R9 | Low | React 19 StrictMode double-invokes effects in dev → CoursePage/LessonPage fetch twice locally (harmless GETs, but surprising). | `main.jsx:7` |
| R10 | Low | No tests anywhere; server `test` script fails by design. | `server/package.json:7` |
| R11 | Info | Bleeding-edge deps (Express 5 / Mongoose 9 / mongodb 7 / React 19 / Node 25). Subtle incompatibilities possible. | both `package.json` |

---

## 7. Prioritized path to a working MVP

The brief's bar: _clean clone + valid `.env` → install + documented run command(s) start both services → enter topic → multi-module course rendered → attached YouTube videos → export PDF → no crashes on the happy path._

**P0 — blockers for that bar**
1. **Replace the Gemini mock with real calls** for both course skeleton and lesson content, wired to `GEMINI_API_KEY`. _(Naive parse-or-throw per Checkpoint 1 — no hardening.)_
2. **Add YouTube enrichment**: new dependency + `YOUTUBE_API_KEY`, a `videos` field on the model, a service that searches per lesson (or module), wired into lesson generation. _(Naive single call per Checkpoint 2.)_
3. **Add PDF export** (`jspdf` on the client) with an export button that renders a course (and its generated lessons) to PDF.
4. **Add server run scripts** (`start`, ideally `dev`) and confirm both services start from a clean clone with one documented command each.
5. **Create `.env.example`** documenting `MONGO_URI`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `PORT`, and a client `VITE_API_URL`.
6. **Verify / fix MongoDB connectivity** (Atlas allowlist) and add fail-fast logging so a bad connection is obvious.

**P1 — correctness/polish on the happy path**
7. Decide **where videos attach and render** (per-lesson vs. on the course page) — see open question below.
8. Move the client API base URL to `VITE_API_URL` (kills R3).
9. Persist + render lesson `objectives` (kills R6, removes dead data).
10. Make MCQ interactive and show `explanation` (kills R7's user-facing impact).

**P2 — resilience & learning (Phase 2 checkpoints — intentionally left naive)**
- CP1 structured-output contract & repair, CP2 API resilience (timeout/backoff/quota/degradation), CP3 progressive generation UX. These stay naive-but-runnable for you to build.

---

## 8. Open questions for you (need answers before/while building Phase 1)

1. **Do you have a YouTube Data API v3 key**, or should enrichment be designed so it's optional/degradable if no key is set? (Affects how I wire the `.env` and the happy-path demo.)
2. **Where should videos appear** — attached to each lesson (fits the lazy per-lesson generation), or aggregated on the course page? The brief says "attached YouTube videos" without specifying. I lean **per-lesson** to match the existing flow.
3. **PDF scope** — export a single lesson, or the whole course (with all generated lesson content)? Whole-course is more useful but only includes lessons you've actually generated.
4. **Gemini model choice** — default to a current fast model (e.g. `gemini-2.x-flash`)? I'll confirm the exact available model id against your key before committing.
5. The current flow generates lessons **lazily on click**. The brief's MVP says "enter a topic, get a generated multi-module course … see attached YouTube videos." Is **lazy per-lesson** acceptable for the MVP, or do you want the whole course (all lessons + videos) generated up front? This materially affects Checkpoint 3's progressive-generation design.

---

**Phase 0 is complete and nothing was modified. Stopping here for your review per the brief. Give me the go (and answers to §8 where you have them) and I'll start Phase 1.**
