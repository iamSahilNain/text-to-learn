import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_URL, ApiError, apiHeaders, fetchJson, invalidResponse, isValidCourse } from '../api'
import { consumeCourseEvents } from '../sse'
import { generationReducer, initialGenerationState } from '../generationReducer'

// A module has no stored status. It is whatever its lessons say it is, and
// an empty module is not a finished one.
function moduleStatus(courseModule) {
  const lessons = courseModule.lessons || []
  if (lessons.length === 0) return 'empty'
  if (lessons.some((lesson) => lesson.generationStatus === 'pending')) return 'pending'
  if (lessons.some((lesson) => lesson.generationStatus === 'degraded')) return 'degraded'
  return 'ready'
}

const LESSON_BADGE = {
  pending: { text: 'Not generated', className: 'text-gray-500' },
  ready: { text: 'Ready', className: 'text-green-400' },
  degraded: { text: 'Fallback — retry available', className: 'text-amber-400' },
}

const MODULE_BADGE = {
  pending: { text: 'Not generated', className: 'bg-gray-800 text-gray-400' },
  ready: { text: 'Ready', className: 'bg-green-900 text-green-300' },
  degraded: { text: 'Fallback', className: 'bg-amber-900 text-amber-200' },
}

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
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
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
      const response = await fetch(`${API_URL}/api/courses/${courseId}/pdf`, { headers: apiHeaders() })
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
    <Centered><p className="text-gray-400 text-xl">Loading course...</p></Centered>
  )

  if (loadStatus === 'not-found') return (
    <Centered><p className="text-red-400 text-xl">Course not found</p></Centered>
  )

  if (loadStatus === 'error') return (
    <Centered>
      <div className="text-center">
        <p role="alert" className="text-red-400 text-xl mb-6">{loadError}</p>
        <button
          onClick={retryLoad}
          className="bg-indigo-700 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          Retry
        </button>
      </div>
    </Centered>
  )

  const generating = generation.status === 'generating'
  const lessons = course.modules.flatMap((courseModule) => courseModule.lessons)
  const degradedCount = lessons.filter((lesson) => lesson.generationStatus === 'degraded').length
  const pendingCount = lessons.filter((lesson) => lesson.generationStatus === 'pending').length
  const startLabel = degradedCount > 0 && pendingCount === 0 ? 'Retry incomplete lessons' : 'Generate full course'

  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-10 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/')}
          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          {generating ? (
            <button
              onClick={handleCancel}
              className="bg-red-900 hover:bg-red-800 text-red-100 text-sm font-medium rounded-lg px-4 py-2 transition"
            >
              Cancel generation
            </button>
          ) : (
            <button
              onClick={startGeneration}
              className="bg-indigo-700 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
            >
              {startLabel}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-lg px-4 py-2 transition"
          >
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {exportError && <p role="alert" className="text-red-400 mb-6 text-sm">{exportError}</p>}

      {course.outlineStatus === 'degraded' && (
        <div className="bg-amber-950 border border-amber-900 text-amber-200 rounded-xl p-4 mb-6 text-sm">
          This course outline is fallback content. Generating lessons will not replace it — create a new
          course to try the outline again.
        </div>
      )}

      {generation.status !== 'idle' && (
        <div className="bg-gray-900 rounded-xl p-4 mb-8 text-sm">
          {generating && (
            <p className="text-indigo-300">
              Processed {generation.receivedModuleIds.length} of {course.modules.length} modules…
            </p>
          )}
          {generation.status === 'complete' && (
            <p className="text-green-400">All {generation.summary.totalLessons} lessons are ready.</p>
          )}
          {generation.status === 'degraded' && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-amber-300">
                {generation.summary.readyLessons} of {generation.summary.totalLessons} lessons are ready.{' '}
                {generation.summary.degradedLessons} lessons contain fallback content.
              </p>
              <button
                onClick={startGeneration}
                className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium rounded-lg px-3 py-1.5 transition whitespace-nowrap"
              >
                Retry incomplete lessons
              </button>
            </div>
          )}
          {generation.status === 'error' && (
            <div className="flex items-center justify-between gap-4">
              <p role="alert" className="text-red-400">
                Generation stopped: {generation.error.message}
              </p>
              {generation.error.retriable ? (
                <button
                  onClick={startGeneration}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium rounded-lg px-3 py-1.5 transition whitespace-nowrap"
                >
                  Retry
                </button>
              ) : (
                <button
                  onClick={() => navigate('/courses')}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium rounded-lg px-3 py-1.5 transition whitespace-nowrap"
                >
                  Back to my courses
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <h1 className="text-4xl font-bold mb-3">{course.title}</h1>
      <p className="text-gray-400 mb-4">{course.description}</p>
      <div className="flex gap-2 mb-10 flex-wrap">
        {course.tags?.map((tag) => (
          <span key={tag} className="bg-indigo-900 text-indigo-200 px-3 py-1 rounded-full text-sm">
            {tag}
          </span>
        ))}
      </div>
      <div className="space-y-6">
        {course.modules.map((courseModule, moduleIndex) => {
          const badge = MODULE_BADGE[moduleStatus(courseModule)]
          return (
            <div key={courseModule._id} className="bg-gray-900 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-4 text-indigo-300 flex items-center gap-2">
                Module {moduleIndex + 1}: {courseModule.title}
                {badge && (
                  <span className={`text-xs rounded-full px-2 py-0.5 ${badge.className}`}>{badge.text}</span>
                )}
              </h2>
              <div className="space-y-2">
                {courseModule.lessons.map((lesson, lessonIndex) => {
                  const lessonBadge = LESSON_BADGE[lesson.generationStatus]
                  return (
                    <button
                      key={lesson._id}
                      onClick={() => navigate(`/lesson/${lesson._id}`)}
                      className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3 text-gray-200 transition flex items-center justify-between"
                    >
                      <span>{lessonIndex + 1}. {lesson.title}</span>
                      <span className={`text-xs ${lessonBadge.className}`}>{lessonBadge.text}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
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

function Centered({ children }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      {children}
    </div>
  )
}
