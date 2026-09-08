import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson, invalidResponse, isValidCourseList } from '../api'

const PAGE_SIZE = 20

export default function CoursesList() {
  const navigate = useNavigate()
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
    }
  }, [load])

  const { courses, page, hasMore, loadStatus, error } = state
  const loading = loadStatus === 'loading'
  const showEmptyState = loadStatus === 'ready' && courses.length === 0

  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-10 max-w-3xl mx-auto">
      <button
        onClick={() => navigate('/')}
        className="text-indigo-400 hover:text-indigo-300 mb-8"
      >
        ← New course
      </button>
      <h1 className="text-3xl font-bold mb-8">My Courses</h1>

      {loading && <p className="text-gray-400 mb-4">Loading courses...</p>}

      {loadStatus === 'error' && (
        <div className="flex items-center justify-between gap-4 mb-6">
          <p role="alert" className="text-red-400">{error}</p>
          <button
            onClick={() => load(requestedPage)}
            className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium rounded-lg px-3 py-1.5 transition whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {showEmptyState && (
        <p className="text-gray-400">
          {page === 1
            ? 'No courses yet — generate one from the home page.'
            : 'No courses on this page.'}
        </p>
      )}

      <div className="space-y-3">
        {courses.map((course) => (
          <button
            key={course._id}
            onClick={() => navigate(`/course/${course._id}`)}
            className="w-full text-left bg-gray-900 hover:bg-gray-800 rounded-xl px-5 py-4 transition"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-100">{course.title}</p>
                {course.description && (
                  <p className="text-sm text-gray-400 mt-1 line-clamp-1">{course.description}</p>
                )}
              </div>
              {course.createdAt && (
                <p className="text-xs text-gray-500 whitespace-nowrap">
                  {new Date(course.createdAt).toLocaleDateString()}
                </p>
              )}
            </div>
            {course.tags?.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {course.tags.map((tag) => (
                  <span key={tag} className="bg-indigo-900 text-indigo-200 px-2 py-0.5 rounded-full text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mt-8">
        <button
          onClick={() => load(page - 1)}
          disabled={loading || page <= 1}
          className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          Previous
        </button>
        <p className="text-sm text-gray-500">Page {page}</p>
        <button
          onClick={() => load(page + 1)}
          disabled={loading || !hasMore}
          className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          Next
        </button>
      </div>
    </div>
  )
}
