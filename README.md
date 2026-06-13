# Text-to-Learn

Enter a topic, get an AI-generated multi-module course. Lesson content is
generated on demand (Gemini), enriched with related YouTube videos, and the
whole course can be exported to PDF.

- **client/** — React 19 + Vite + Tailwind SPA
- **server/** — Node + Express 5 + Mongoose (MongoDB)

> New to the codebase? Read the docs in this order:
> [ARCHITECTURE.md](ARCHITECTURE.md) → [ANNOTATED.md](ANNOTATED.md) →
> [DECISIONS.md](DECISIONS.md) → [LEARNING.md](LEARNING.md). Term you don't
> recognise? See [GLOSSARY.md](GLOSSARY.md).

---

## Prerequisites

- Node.js 20+ (developed on 25; uses built-in `fetch`, `--watch`, `node:test`)
- A MongoDB database (Atlas connection string or a local `mongod`)
- A Google **Gemini** API key — https://aistudio.google.com/app/apikey
- _(Optional)_ A **YouTube Data API v3** key — without it, lessons generate
  fine, just with no videos.

## Setup

```bash
# 1. Backend
cd server
npm install
cp .env.example .env        # then fill in MONGO_URI and GEMINI_API_KEY

# 2. Frontend
cd ../client
npm install
cp .env.example .env        # optional; defaults to http://localhost:3001
```

### Environment variables

| File | Var | Required | Purpose |
|---|---|---|---|
| `server/.env` | `MONGO_URI` | ✅ | MongoDB connection string |
| `server/.env` | `GEMINI_API_KEY` | ✅ | Gemini course/lesson generation |
| `server/.env` | `GEMINI_MODEL` | – | Model id (default `gemini-2.5-flash`) |
| `server/.env` | `YOUTUBE_API_KEY` | – | Video enrichment (degrades to none) |
| `server/.env` | `PORT` | – | API port (default `3001`) |
| `client/.env` | `VITE_API_URL` | – | Backend base URL (default localhost:3001) |

`.env` is gitignored — never commit real keys.

## Run

Two processes, two terminals:

```bash
# Terminal 1 — API (http://localhost:3001)
cd server && npm run dev      # or: npm start

# Terminal 2 — UI (http://localhost:5173)
cd client && npm run dev
```

Open the UI, type a topic, generate a course, open a lesson and click
**Generate Lesson Content**, then **Export PDF** from the course page.

## Test

```bash
cd server && npm test         # node --test
cd client && npm test         # node --test
```

The suites currently contain only the **learning-checkpoint specs**, which are
skipped on purpose (see below).

---

## What to build next

The hard, interesting parts are intentionally left as **three learning
checkpoints**. Each ships in a deliberately naive form that keeps the app
working, is marked in code with `// LEARNING CHECKPOINT #n`, and has a skipped
spec test describing the target behaviour.

1. **#1 — LLM structured-output contract & repair** → `server/services/gemini.js`
2. **#2 — External-API resilience (Gemini + YouTube)** → `server/services/youtube.js`, `gemini.js`
3. **#3 — Progressive generation UX + frontend state** → `client/src/pages/LessonPage.jsx`

Full write-ups (the problem, why naive fails, hints, and reading) live in
[LEARNING.md](LEARNING.md). Activate a checkpoint by un-skipping its spec test
and implementing until it passes.

## Project status

See [STATUS.md](STATUS.md) for the original audit and the prioritized MVP path.
