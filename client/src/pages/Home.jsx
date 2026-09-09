import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { fetchJson } from '../api'
import { isDemoMode } from '../appMode'
import AppShell from '../components/AppShell'
import { useDocumentTitle } from '../useDocumentTitle'
import { DEMO_COURSE } from '../demo/demoData'

const MAX_TOPIC_LENGTH = 200

export default function Home() {
  useDocumentTitle('Text to Learn')
  return isDemoMode ? <DemoHome /> : <PrivateHome />
}

function DemoHome() {
  const moduleCount = DEMO_COURSE.modules.length
  const lessonCount = DEMO_COURSE.modules.reduce((total, m) => total + m.lessons.length, 0)

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl py-8 text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-wide text-accent">
          A topic. A structured learning path.
        </p>
        <h1 className="mb-5 text-4xl font-bold text-text sm:text-5xl">Turn a topic into a course.</h1>
        <p className="mb-8 text-lg text-text-muted">
          Explore a complete sample with focused lessons, code examples and quizzes.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/demo/react-fundamentals"
            className="rounded-xl bg-action px-6 py-3 font-semibold text-white transition hover:bg-action-hover"
          >
            Explore sample course
          </Link>
          <a
            href="https://github.com/iamSahilNain/text-to-learn"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-border px-6 py-3 font-semibold text-text transition hover:bg-surface"
          >
            View source on GitHub
          </a>
        </div>
        <p className="mt-6 text-sm text-text-muted">
          The public demo uses a prepared sample. Live generation is available in the private app.
        </p>
      </div>

      <div className="mx-auto mt-4 max-w-xl rounded-2xl border border-border bg-surface p-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">Curated sample</p>
        <h2 className="mb-2 text-xl font-semibold text-text">{DEMO_COURSE.title}</h2>
        <p className="mb-4 text-sm text-text-muted">{DEMO_COURSE.description}</p>
        <p className="text-sm text-text-muted">
          {moduleCount} modules · {lessonCount} lessons
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-2xl gap-6 text-center sm:grid-cols-3">
        {[
          ['1', 'Start with a topic'],
          ['2', 'Build an outline'],
          ['3', 'Learn lesson by lesson'],
        ].map(([step, label]) => (
          <div key={step}>
            <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-sm font-semibold text-accent">
              {step}
            </div>
            <p className="text-sm text-text-muted">{label}</p>
          </div>
        ))}
      </div>
    </AppShell>
  )
}

function PrivateHome() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  // The disabled attribute only takes effect after React commits the next
  // render, so a burst of Enter presses needs a synchronous guard too.
  const busyRef = useRef(false)
  const controllerRef = useRef(null)
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      controllerRef.current?.abort()
      controllerRef.current = null
      busyRef.current = false
    }
  }, [])

  async function handleGenerate(event) {
    event.preventDefault()

    const trimmed = topic.trim()
    if (busyRef.current || !trimmed) return
    busyRef.current = true

    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError('')

    try {
      const course = await fetchJson('/api/courses/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: trimmed }),
        signal: controller.signal,
      })
      if (!activeRef.current || controller.signal.aborted) return
      if (typeof course?._id !== 'string' || course._id.length === 0) {
        throw new Error('The server sent an unexpected course.')
      }
      navigate(`/course/${course._id}`)
    } catch (err) {
      if (err?.name === 'AbortError' || !activeRef.current) return
      setError(err?.message || 'Failed to generate course. Try again.')
    } finally {
      // Only the request that is still current may release the controls.
      if (controllerRef.current === controller) {
        controllerRef.current = null
        busyRef.current = false
        setLoading(false)
      }
    }
  }

  const disabled = loading || topic.trim().length === 0

  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
        <h1 className="mb-4 text-5xl font-bold text-text">Text to Learn</h1>
        <p className="mb-10 text-lg text-text-muted">
          Create a course outline from a topic, then generate lessons when you need them.
        </p>
        <form className="w-full max-w-xl" onSubmit={handleGenerate}>
          <label htmlFor="topic" className="mb-2 block text-left text-sm font-medium text-text-muted">
            Topic
          </label>
          <input
            id="topic"
            type="text"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            disabled={loading}
            maxLength={MAX_TOPIC_LENGTH}
            placeholder="e.g. Introduction to React Hooks"
            className="mb-4 w-full rounded-xl border border-border bg-surface px-5 py-4 text-lg text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-accent disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled}
            className="w-full rounded-xl bg-action py-4 text-lg font-semibold text-white transition hover:bg-action-hover disabled:bg-surface-raised disabled:text-text-muted"
          >
            {loading ? 'Creating outline…' : 'Create outline'}
          </button>
          {error && <p role="alert" className="mt-4 text-center text-danger">{error}</p>}
        </form>
        <button
          onClick={() => navigate('/courses')}
          className="mt-10 text-sm text-accent transition hover:text-text"
        >
          View my courses →
        </button>
      </div>
    </AppShell>
  )
}
