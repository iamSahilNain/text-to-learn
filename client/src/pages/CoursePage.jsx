import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { API_URL, ApiError, fetchJson, invalidResponse, isValidCourse } from '../api'
import { consumeCourseEvents } from '../sse'
import { generationReducer, initialGenerationState } from '../generationReducer'
import AppShell, { Centered } from '../components/AppShell'
import ModuleList from '../components/ModuleList'
import CourseProgress from '../components/CourseProgress'
import { useDocumentTitle } from '../useDocumentTitle'

export default function CoursePage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(generationReducer, initialGenerationState)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // The single allocator for generation tokens. Every dispatch from inside
  // an async run carries the token it was started with.
  const generationTokenRef = useRef(0)
  const generationControllerRef = useRef(null)
  const generationBusyRef = useRef(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const { course, loadStatus, loadError, generation } = state

  useDocumentTitle(course ? `${course.title} | Text to Learn` : 'Text to Learn')

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchJson(`/api/courses/${courseId}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return
        if (!isValidCourse(data)) throw invalidResponse('course')
        dispatch({ type: 'LOAD_SUCCESS', course: data })
      })
      .catch((err) => {
        if (!active || err?.name === 'AbortError') return
        dispatch({ type: 'LOAD_FAILURE', status: err?.status, error: err?.message || 'Failed to load course.' })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [courseId, loadAttempt])

  // Invalidate before aborting: no queued event can then reach the reducer.
  useEffect(() => () => {
    generationTokenRef.current += 1
    generationControllerRef.current?.abort()
  }, [])

  const startGeneration = useCallback(async () => {
    // Synchronous guard: a second click lands before React has re-rendered
    // the disabled button.
    if (generationBusyRef.current) return
    generationBusyRef.current = true

    generationTokenRef.current += 1
    const token = generationTokenRef.current
    const controller = new AbortController()
    generationControllerRef.current = controller

    const isCurrent = () => generationTokenRef.current === token && !controller.signal.aborted

    dispatch({ type: 'START', token })

    try {
      const response = await fetch(`${API_URL}/api/courses/${courseId}/generate-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Ready lessons are reused; degraded and pending ones are retried.
        body: JSON.stringify({ force: false }),
        signal: controller.signal,
      })

      await consumeCourseEvents(response, {
        isCurrent,
        onModule: (courseModule) => dispatch({ type: 'MODULE_RECEIVED', token, module: courseModule }),
        onDone: (summary) => {
          const problem = summaryProblem(summary, courseId, course)
          if (problem) {
            dispatch({ type: 'ERROR', token, error: { code: 'invalid_response', message: problem, retriable: true } })
            return
          }
          dispatch({ type: 'DONE', token, summary })
        },
        onError: (payload) => dispatch({ type: 'ERROR', token, error: payload }),
      })
    } catch (err) {
      if (err?.name !== 'AbortError' && isCurrent()) {
        dispatch({
          type: 'ERROR',
          token,
          error: {
            code: err?.code || 'request_failed',
            message: err?.message || 'Generation failed.',
            retriable: err instanceof ApiError ? err.retriable : true,
          },
        })
      }
    } finally {
      // An older run's cleanup must never clear a newer run's controller.
      if (generationControllerRef.current === controller) {
        generationControllerRef.current = null
        generationBusyRef.current = false
      }
    }
  }, [courseId, course])

  function handleCancel() {
    generationTokenRef.current += 1
    dispatch({ type: 'CANCEL', token: generationTokenRef.current })
    const controller = generationControllerRef.current
    generationControllerRef.current = null
    generationBusyRef.current = false
    controller?.abort()
  }

  function retryLoad() {
    dispatch({ type: 'LOAD_START' })
    setLoadAttempt((attempt) => attempt + 1)
  }

  async function handleExport() {
    if (!course) return
    setExporting(true)
    setExportError('')
    let objectUrl = null
    try {
      const response = await fetch(`${API_URL}/api/courses/${courseId}/pdf`)
      if (!response.ok) throw new Error(`server export failed (HTTP ${response.status})`)
      const blob = await response.blob()
      // An empty body or an error page is not a PDF, however it is labelled.
      if (blob.size === 0 || !blob.type.includes('application/pdf')) {
        throw new Error('server export returned something other than a PDF')
      }
      objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `${(course.title || 'course').replace(/[^\w]+/g, '-').toLowerCase()}.pdf`
      link.click()
    } catch {
      try {
        const { exportCourseToPdf } = await import('../pdf')
        exportCourseToPdf(course)
      } catch {
        setExportError('PDF export failed. Please try again.')
      }
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setExporting(false)
    }
  }

  if (loadStatus === 'loading') return (
    <AppShell><Centered><p className="text-xl text-text-muted">Loading course...</p></Centered></AppShell>
  )

  if (loadStatus === 'not-found') return (
    <AppShell><Centered><p className="text-xl text-danger">Course not found</p></Centered></AppShell>
  )

  if (loadStatus === 'error') return (
    <AppShell>
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

  const generating = generation.status === 'generating'
  const lessons = course.modules.flatMap((courseModule) => courseModule.lessons)
  const degradedCount = lessons.filter((lesson) => lesson.generationStatus === 'degraded').length
  const pendingCount = lessons.filter((lesson) => lesson.generationStatus === 'pending').length
  const startLabel = degradedCount > 0 && pendingCount === 0 ? 'Retry incomplete lessons' : 'Generate full course'

  return (
    <AppShell width={960}>
      <div className="mb-8 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-accent transition hover:text-text">
          ← Back
        </Link>
        <div className="flex gap-2">
          {generating ? (
            <button
              onClick={handleCancel}
              className="rounded-lg bg-danger/15 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/25"
            >
              Cancel generation
            </button>
          ) : (
            <button
              onClick={startGeneration}
              className="rounded-lg bg-action px-4 py-2 text-sm font-medium text-white transition hover:bg-action-hover"
            >
              {startLabel}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text transition hover:bg-border disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {exportError && <p role="alert" className="mb-6 text-sm text-danger">{exportError}</p>}

      {course.outlineStatus === 'degraded' && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          This course outline is fallback content. Generating lessons will not replace it — create a new
          course to try the outline again.
        </div>
      )}

      {generation.status !== 'idle' && (
        <div className="mb-8 rounded-xl bg-surface p-4 text-sm">
          {generating && (
            <p className="text-accent">
              Processed {generation.receivedModuleIds.length} of {course.modules.length} modules…
            </p>
          )}
          {generation.status === 'complete' && (
            <p className="text-success">All {generation.summary.totalLessons} lessons are ready.</p>
          )}
          {generation.status === 'degraded' && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-warning">
                {generation.summary.readyLessons} of {generation.summary.totalLessons} lessons are ready.{' '}
                {generation.summary.degradedLessons} lessons contain fallback content.
              </p>
              <button
                onClick={startGeneration}
                className="whitespace-nowrap rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-medium text-text transition hover:bg-border"
              >
                Retry incomplete lessons
              </button>
            </div>
          )}
          {generation.status === 'error' && (
            <div className="flex items-center justify-between gap-4">
              <p role="alert" className="text-danger">
                Generation stopped: {generation.error.message}
              </p>
              {generation.error.retriable ? (
                <button
                  onClick={startGeneration}
                  className="whitespace-nowrap rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-medium text-text transition hover:bg-border"
                >
                  Retry
                </button>
              ) : (
                <button
                  onClick={() => navigate('/courses')}
                  className="whitespace-nowrap rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-medium text-text transition hover:bg-border"
                >
                  Back to my courses
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <h1 className="mb-3 text-4xl font-bold text-text">{course.title}</h1>
      <p className="mb-4 text-text-muted">{course.description}</p>
      {course.tags?.length > 0 && (
        <p className="mb-8 text-sm text-text-muted">{course.tags.join(' · ')}</p>
      )}

      <CourseProgress modules={course.modules} />

      <ModuleList modules={course.modules} lessonHref={(lesson) => `/lesson/${lesson._id}`} />
    </AppShell>
  )
}

// A completion record has to describe the course actually on screen.
function summaryProblem(summary, courseId, course) {
  if (summary.courseId !== courseId) return 'The server reported a different course.'
  const { readyLessons, degradedLessons, totalLessons } = summary
  if (readyLessons < 0 || degradedLessons < 0 || totalLessons < 0) return 'The server reported impossible counts.'
  if (readyLessons + degradedLessons !== totalLessons) return 'The server reported inconsistent counts.'
  if (summary.status === 'complete' && degradedLessons !== 0) return 'The server reported inconsistent counts.'
  if (summary.status === 'degraded' && degradedLessons === 0) return 'The server reported inconsistent counts.'
  const expected = course ? course.modules.reduce((total, entry) => total + entry.lessons.length, 0) : totalLessons
  if (totalLessons !== expected) return 'The server reported a different lesson count.'
  return null
}
