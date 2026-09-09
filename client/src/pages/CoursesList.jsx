import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchJson, invalidResponse, isValidCourseList } from '../api'
import AppShell from '../components/AppShell'
import { useDocumentTitle } from '../useDocumentTitle'

const PAGE_SIZE = 20
const VISIBLE_TAGS = 3

export default function CoursesList() {
  useDocumentTitle('Courses | Text to Learn')
  const [state, setState] = useState({
    courses: [],
    page: 1,
    hasMore: false,
    loadStatus: 'loading', // loading | ready | error
    error: null,
  })
  const [requestedPage, setRequestedPage] = useState(1)

  // A monotonic id per request, plus a synchronous guard: rapid Next clicks
  // must not queue several fetches before the first render lands.
  const requestIdRef = useRef(0)
  const busyRef = useRef(false)
  const controllerRef = useRef(null)

  const load = useCallback(async (page) => {
    if (busyRef.current) return
    busyRef.current = true

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller

    // Existing cards and the last successful page stay put while the next
    // page is in flight.
    setState((previous) => ({ ...previous, loadStatus: 'loading', error: null }))
    setRequestedPage(page)

    try {
      const payload = await fetchJson(`/api/courses?page=${page}&limit=${PAGE_SIZE}`, {
        signal: controller.signal,
      })
      if (requestIdRef.current !== requestId) return
      if (!isValidCourseList(payload, { page, pageSize: PAGE_SIZE })) throw invalidResponse('course list')

      setState({
        courses: payload.courses,
        page: payload.page,
        hasMore: payload.hasMore,
        loadStatus: 'ready',
        error: null,
      })
    } catch (err) {
      if (err?.name === 'AbortError' || requestIdRef.current !== requestId) return
      // The previously loaded page is kept: a failure loses nothing.
      setState((previous) => ({
        ...previous,
        loadStatus: 'error',
        error: err?.message || 'Failed to load courses.',
      }))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        busyRef.current = false
      }
    }
  }, [])

  useEffect(() => {
    load(1)
    return () => {
      requestIdRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
      busyRef.current = false
    }
  }, [load])

  const { courses, page, hasMore, loadStatus, error } = state
  const loading = loadStatus === 'loading'
  const showEmptyState = loadStatus === 'ready' && courses.length === 0

  return (
    <AppShell width={960}>
      <Link to="/" className="mb-8 inline-block text-accent transition hover:text-text">
        ← New course
      </Link>
      <h1 className="mb-8 text-3xl font-bold text-text">Courses</h1>

      {loading && <p className="mb-4 text-text-muted">Loading courses...</p>}

      {loadStatus === 'error' && (
        <div className="mb-6 flex items-center justify-between gap-4">
          <p role="alert" className="text-danger">{error}</p>
          <button
            onClick={() => load(requestedPage)}
            className="whitespace-nowrap rounded-lg bg-surface-raised px-3 py-1.5 text-sm font-medium text-text transition hover:bg-border"
          >
            Retry
          </button>
        </div>
      )}

      {showEmptyState && (
        <p className="text-text-muted">
          {page === 1
            ? 'No courses yet — generate one from the home page.'
            : 'No courses on this page.'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {courses.map((course) => {
          const visibleTags = course.tags?.slice(0, VISIBLE_TAGS) || []
          const hiddenTagCount = (course.tags?.length || 0) - visibleTags.length
          return (
            <Link
              key={course._id}
              to={`/course/${course._id}`}
              className="block rounded-lg border border-border bg-surface px-5 py-4 transition hover:border-text/50"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="font-semibold text-text">{course.title}</p>
                {course.createdAt && (
                  <p className="whitespace-nowrap text-xs text-text-muted">
                    {new Date(course.createdAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              {course.description && (
                <p className="mt-1 line-clamp-2 text-sm text-text-muted">{course.description}</p>
              )}
              {visibleTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {visibleTags.map((tag) => (
                    <span key={tag} className="rounded border border-border px-2 py-0.5 text-xs text-text-muted">
                      {tag}
                    </span>
                  ))}
                  {hiddenTagCount > 0 && (
                    <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
                      +{hiddenTagCount}
                    </span>
                  )}
                </div>
              )}
            </Link>
          )
        })}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={() => load(page - 1)}
          disabled={loading || page <= 1}
          className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text transition hover:bg-border disabled:opacity-40"
        >
          Previous
        </button>
        <p className="text-sm text-text-muted">Page {page}</p>
        <button
          onClick={() => load(page + 1)}
          disabled={loading || !hasMore}
          className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text transition hover:bg-border disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </AppShell>
  )
}
