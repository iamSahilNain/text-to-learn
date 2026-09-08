import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { CourseRoute, LessonRoute } from '../src/App'

export const API_URL = 'http://localhost:3001'

// A promise whose settlement the test controls, so ordering can be asserted
// rather than waited out.
export function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export function jsonResponse(body, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    async json() { return body },
    async text() { return JSON.stringify(body) },
  }
}

export function nonJsonResponse({ status = 200, body = '<html>oops</html>' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/html' }),
    async json() { throw new SyntaxError('Unexpected token <') },
    async text() { return body },
  }
}

// A text/event-stream response whose chunks the test pushes by hand.
export function streamResponse({ status = 200, contentType = 'text/event-stream' } = {}) {
  let controller
  const body = new ReadableStream({
    start(streamController) { controller = streamController },
  })
  const encoder = new TextEncoder()
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': contentType }),
      body,
      async json() { return {} },
    },
    push(text) { controller.enqueue(encoder.encode(text)) },
    pushBytes(bytes) { controller.enqueue(bytes) },
    close() { controller.close() },
  }
}

export function sseRecord(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// Routes the fetch mock by URL, so a test states what each endpoint returns
// rather than counting calls in order.
export function mockFetch(routes) {
  const calls = []
  const handler = vi.fn(async (url, options = {}) => {
    const path = String(url).replace(API_URL, '')
    calls.push({ path, options })
    for (const [pattern, respond] of routes) {
      const matcher = pattern instanceof RegExp ? pattern : new RegExp(`^${pattern}$`)
      if (matcher.test(path)) return respond({ path, options, calls })
    }
    throw new Error(`unexpected request: ${options.method || 'GET'} ${path}`)
  })
  handler.calls = calls
  globalThis.fetch = handler
  return handler
}

// `links` renders in-router navigation so a test can move between two
// resources of the same route pattern, which is the case that used to leave
// the previous resource's state on screen.
export function renderCourseRoute(courseId, { links = [] } = {}) {
  return (
    <MemoryRouter initialEntries={[`/course/${courseId}`]}>
      <nav>
        {links.map((id) => <Link key={id} to={`/course/${id}`}>Go to course {id}</Link>)}
      </nav>
      <Routes>
        <Route path="/course/:courseId" element={<CourseRoute />} />
        <Route path="/lesson/:lessonId" element={<LessonRoute />} />
        <Route path="/courses" element={<p>My Courses</p>} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>
  )
}

export function renderLessonRoute(lessonId, { links = [] } = {}) {
  return (
    <MemoryRouter initialEntries={[`/lesson/${lessonId}`]}>
      <nav>
        {links.map((id) => <Link key={id} to={`/lesson/${id}`}>Go to lesson {id}</Link>)}
      </nav>
      <Routes>
        <Route path="/lesson/:lessonId" element={<LessonRoute />} />
        <Route path="/course/:courseId" element={<CourseRoute />} />
      </Routes>
    </MemoryRouter>
  )
}

export function lesson(id, overrides = {}) {
  return {
    _id: id,
    title: `Lesson ${id}`,
    objectives: [],
    content: [],
    videos: [],
    generationStatus: 'pending',
    enrichmentStatus: 'pending',
    ...overrides,
  }
}

export function courseModule(id, lessons, overrides = {}) {
  return { _id: id, title: `Module ${id}`, lessons, ...overrides }
}

export function course(id, modules, overrides = {}) {
  return {
    _id: id,
    title: `Course ${id}`,
    description: 'A course.',
    tags: [],
    outlineStatus: 'ready',
    modules,
    ...overrides,
  }
}
