import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchJson, invalidResponse, isValidLesson } from '../api'
import AppShell, { Centered } from '../components/AppShell'
import LessonBody from '../components/LessonBody'
import { useDocumentTitle } from '../useDocumentTitle'

export default function LessonPage() {
  const { lessonId } = useParams()
  const [lesson, setLesson] = useState(null)
  const [loadStatus, setLoadStatus] = useState('loading') // loading | ready | not-found | error
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')

  // The generate request has its own lifecycle: the loaded lesson must
  // survive a failed regeneration untouched.
  const requestTokenRef = useRef(0)
  const requestControllerRef = useRef(null)
  const busyRef = useRef(false)

  useDocumentTitle(lesson ? `${lesson.title} | Text to Learn` : 'Text to Learn')

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchJson(`/api/lessons/${lessonId}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return
        if (!isValidLesson(data)) throw invalidResponse('lesson')
        setLesson(data)
        setLoadStatus('ready')
      })
      .catch((err) => {
        if (!active || err?.name === 'AbortError') return
        setLoadStatus(err?.status === 404 ? 'not-found' : 'error')
        setLoadError(err?.message || 'Failed to load lesson.')
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [lessonId, loadAttempt])

  useEffect(() => () => {
    requestTokenRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  function retryLoad() {
    setLoadStatus('loading')
    setLoadError('')
    setLoadAttempt((attempt) => attempt + 1)
  }

  async function handleGenerate() {
    if (busyRef.current) return
    busyRef.current = true

    requestTokenRef.current += 1
    const token = requestTokenRef.current
    const controller = new AbortController()
    requestControllerRef.current = controller

    setGenerating(true)
    setGenerationError('')

    try {
      const data = await fetchJson(`/api/lessons/${lessonId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
        signal: controller.signal,
      })
      if (requestTokenRef.current !== token || controller.signal.aborted) return
      if (!isValidLesson(data) || data._id !== lessonId) throw invalidResponse('lesson')
      // Only a complete, valid lesson replaces what is on screen.
      setLesson(data)
    } catch (err) {
      if (err?.name === 'AbortError' || requestTokenRef.current !== token) return
      setGenerationError(err?.message || 'Generation failed.')
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
        busyRef.current = false
        setGenerating(false)
      }
    }
  }

  if (loadStatus === 'loading') return (
    <AppShell width={760}><Centered><p className="text-xl text-text-muted">Loading lesson...</p></Centered></AppShell>
  )

  if (loadStatus === 'not-found') return (
    <AppShell width={760}><Centered><p className="text-xl text-danger">Lesson not found</p></Centered></AppShell>
  )

  if (loadStatus === 'error') return (
    <AppShell width={760}>
      <Centered>
        <div className="text-center">
          <p role="alert" className="mb-6 text-xl text-danger">{loadError}</p>
          <button
            onClick={retryLoad}
            className="rounded-lg bg-action px-4 py-2 text-sm font-medium text-white transition hover:bg-action-hover"
          >
            Retry
          </button>
        </div>
      </Centered>
    </AppShell>
  )

  // Deterministic parent navigation: the server attaches courseId derived
  // from the lesson's module (see server/routes/lessonRoutes.js). Falling
  // back to the courses list keeps a direct lesson link usable even if an
  // older API response never carried it.
  const parentHref = lesson.courseId ? `/course/${lesson.courseId}` : '/courses'
  const parentLabel = lesson.courseId ? '← Back to course' : '← Back to courses'

  return (
    <AppShell width={760}>
      <Link to={parentHref} className="mb-8 inline-block text-accent transition hover:text-text">
        {parentLabel}
      </Link>
      <h1 className="mb-6 text-3xl font-bold text-text">{lesson.title}</h1>

      {generationError && <p role="alert" className="mb-6 text-danger">{generationError}</p>}

      <LessonBody lesson={lesson} generating={generating} onGenerate={handleGenerate} />
    </AppShell>
  )
}
