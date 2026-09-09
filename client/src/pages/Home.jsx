import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { fetchJson } from '../api'
import { isDemoMode } from '../appMode'
import AppShell from '../components/AppShell'
import SampleCourseCard from '../components/SampleCourseCard'
import { useDocumentTitle } from '../useDocumentTitle'

const MAX_TOPIC_LENGTH = 200
const REPO_URL = 'https://github.com/iamSahilNain/text-to-learn'

const STEPS = [
  ['Start with a topic', 'One line is enough — "Rust ownership", "React hooks".'],
  ['Build an outline', 'Modules and lesson titles come first, so you can see the shape before anything is written.'],
  ['Learn lesson by lesson', 'Each lesson is generated when you reach it, not all of them up front.'],
]

export default function Home() {
  useDocumentTitle('Text to Learn')
  return isDemoMode ? <DemoHome /> : <PrivateHome />
}

function Headline({ children }) {
  return (
    <>
      <p className="text-sm text-accent">A topic. A structured learning path.</p>
      <h1 className="mt-3 text-5xl leading-[1.05] text-text sm:text-6xl">
        Turn a topic
        <br />
        into a course.
      </h1>
      <p className="mt-6 max-w-md text-lg leading-relaxed text-text-muted">{children}</p>
    </>
  )
}

function HowItWorks() {
  return (
    <ol className="mt-8 divide-y divide-border border-t border-border">
      {STEPS.map(([label, detail], index) => (
        <li key={label} className="flex gap-5 py-4">
          <span className="font-serif text-2xl leading-none text-accent">{index + 1}</span>
          <div>
            <p className="font-medium text-text">{label}</p>
            <p className="mt-0.5 text-sm text-text-muted">{detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// Desktop is two columns -- the pitch and primary action on the left, the
// sample and how-it-works on the right -- so a wide viewport is not mostly
// margin. Below `lg` the columns stack in reading order.
function TwoColumn({ left, right }) {
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,6fr)] lg:gap-16">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  )
}

function DemoHome() {
  return (
    <AppShell>
      <TwoColumn
        left={
          <>
            <Headline>Explore a complete sample with focused lessons, code examples and quizzes.</Headline>
            <p className="mt-8 border-l-2 border-accent pl-4 text-sm text-text-muted">
              The public demo uses a prepared sample. Live generation is available in the private app.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block text-sm font-medium text-text underline decoration-border underline-offset-4 transition hover:decoration-text"
            >
              View source on GitHub
            </a>
          </>
        }
        right={
          <>
            <SampleCourseCard />
            <HowItWorks />
          </>
        }
      />
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
      <TwoColumn
        left={
          <>
            <Headline>Create a course outline from a topic, then generate lessons when you need them.</Headline>

            <form className="mt-10" onSubmit={handleGenerate}>
              <label htmlFor="topic" className="block text-sm font-medium text-text">
                Topic
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  id="topic"
                  type="text"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  disabled={loading}
                  maxLength={MAX_TOPIC_LENGTH}
                  placeholder="e.g. Introduction to React Hooks"
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-4 py-3 text-base text-text outline-none placeholder:text-text-muted/70 focus:border-text disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={disabled}
                  className="rounded-md bg-action px-5 py-3 font-medium text-white transition hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? 'Creating outline…' : 'Create outline'}
                </button>
              </div>
              {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
              <p className="mt-4 text-sm text-text-muted">
                Already have courses?{' '}
                <Link
                  to="/courses"
                  className="font-medium text-text underline decoration-border underline-offset-4 transition hover:decoration-text"
                >
                  Browse them
                </Link>
              </p>
            </form>
          </>
        }
        right={
          <>
            <SampleCourseCard />
            <HowItWorks />
          </>
        }
      />
    </AppShell>
  )
}
