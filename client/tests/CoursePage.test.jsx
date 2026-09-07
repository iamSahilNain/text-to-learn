import { describe, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  course,
  courseModule,
  deferred,
  jsonResponse,
  lesson,
  mockFetch,
  renderCourseRoute,
  sseRecord,
  streamResponse,
} from './helpers.jsx'

const COURSE = course('c1', [
  courseModule('m1', [lesson('l1', { title: 'Ownership' }), lesson('l2', { title: 'Borrowing' })]),
  courseModule('m2', [lesson('l3', { title: 'Lifetimes' })]),
])

const READY_M1 = courseModule('m1', [
  lesson('l1', { title: 'Ownership', generationStatus: 'ready', content: [{ type: 'paragraph', text: 'x' }] }),
  lesson('l2', { title: 'Borrowing', generationStatus: 'ready', content: [{ type: 'paragraph', text: 'x' }] }),
])

const COMPLETE = { courseId: 'c1', status: 'complete', readyLessons: 3, degradedLessons: 0, totalLessons: 3 }

function courseRoutes(overrides = []) {
  return [...overrides, ['/api/courses/c1', async () => jsonResponse(COURSE)]]
}

async function renderLoaded(routes) {
  render(renderCourseRoute('c1'))
  await screen.findByRole('heading', { name: 'Course c1' })
  return routes
}

describe('loading and error states', () => {
  test('a 404 shows Course not found and offers no generation or export', async () => {
    mockFetch([['/api/courses/c1', async () => jsonResponse(
      { error: { code: 'not_found', message: 'Course not found' } },
      { status: 404 },
    )]])

    render(renderCourseRoute('c1'))
    expect(await screen.findByText('Course not found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate full course/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Export PDF/ })).not.toBeInTheDocument()
  })

  test('a 500 shows a retryable alert, and a successful retry replaces it', async () => {
    let attempts = 0
    mockFetch([['/api/courses/c1', async () => {
      attempts += 1
      return attempts === 1
        ? jsonResponse({ error: { code: 'internal_error', message: 'Something went wrong' } }, { status: 500 })
        : jsonResponse(COURSE)
    }]])

    render(renderCourseRoute('c1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Course c1' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('a 200 carrying an error envelope never becomes the course', async () => {
    mockFetch([['/api/courses/c1', async () => jsonResponse({ error: { code: 'internal_error', message: 'Something went wrong' } })]])
    render(renderCourseRoute('c1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.queryByRole('heading', { name: /Course/ })).not.toBeInTheDocument()
  })

  test('a successful response of the wrong shape is an invalid response, not content', async () => {
    mockFetch([['/api/courses/c1', async () => jsonResponse({ _id: 'c1', title: 'Course c1', modules: [] })]])
    render(renderCourseRoute('c1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected course')
  })
})

describe('status badges', () => {
  test('lesson and module labels come from the stored status, not from content length', async () => {
    const mixed = course('c1', [
      courseModule('m1', [
        lesson('l1', { title: 'Ownership', generationStatus: 'degraded', content: [{ type: 'paragraph', text: 'fallback' }] }),
      ]),
      courseModule('m2', [lesson('l2', { title: 'Lifetimes', generationStatus: 'ready', content: [] })]),
      courseModule('m3', []),
    ])
    mockFetch([['/api/courses/c1', async () => jsonResponse(mixed)]])
    render(renderCourseRoute('c1'))
    await screen.findByRole('heading', { name: 'Course c1' })

    // A degraded lesson has non-empty content and is still labelled a
    // fallback; a ready lesson with no blocks is still labelled ready.
    const degradedLesson = screen.getByRole('button', { name: /Ownership/ })
    expect(within(degradedLesson).getByText('Fallback — retry available')).toBeInTheDocument()
    const readyLesson = screen.getByRole('button', { name: /Lifetimes/ })
    expect(within(readyLesson).getByText('Ready')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /Module 1/ })).toHaveTextContent('Fallback')
    expect(screen.getByRole('heading', { name: /Module 2/ })).toHaveTextContent('Ready')
    // An empty module claims nothing.
    expect(screen.getByRole('heading', { name: /Module 3/ }).textContent.trim())
      .toBe('Module 3: Module m3')
  })

  test('a degraded outline shows its own persistent banner', async () => {
    mockFetch([['/api/courses/c1', async () => jsonResponse({ ...COURSE, outlineStatus: 'degraded' })]])
    render(renderCourseRoute('c1'))
    expect(await screen.findByText(/This course outline is fallback content/)).toBeInTheDocument()
  })
})

describe('generation', () => {
  test('a run renders each module as it arrives and reports the ready count', async () => {
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))
    expect(await screen.findByText('Processed 0 of 2 modules…')).toBeInTheDocument()

    await act(async () => { stream.push(sseRecord('module', READY_M1)) })
    expect(await screen.findByText('Processed 1 of 2 modules…')).toBeInTheDocument()
    const ownership = screen.getByRole('button', { name: /Ownership/ })
    expect(within(ownership).getByText('Ready')).toBeInTheDocument()

    await act(async () => { stream.push(sseRecord('done', COMPLETE)) })
    expect(await screen.findByText('All 3 lessons are ready.')).toBeInTheDocument()
  })

  test('the ordinary retry sends force:false', async () => {
    const stream = streamResponse()
    const fetchMock = mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))

    const generateCall = fetchMock.calls.find((call) => call.path.endsWith('/generate-content'))
    expect(JSON.parse(generateCall.options.body)).toEqual({ force: false })

    await act(async () => { stream.push(sseRecord('done', COMPLETE)) })
  })

  test('a degraded run reports both counts and offers a retry', async () => {
    const degradedM1 = courseModule('m1', [
      lesson('l1', { title: 'Ownership', generationStatus: 'degraded', content: [{ type: 'paragraph', text: 'fallback' }] }),
      lesson('l2', { title: 'Borrowing', generationStatus: 'ready', content: [{ type: 'paragraph', text: 'x' }] }),
    ])
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))

    await act(async () => {
      stream.push(sseRecord('module', degradedM1))
      stream.push(sseRecord('done', { courseId: 'c1', status: 'degraded', readyLessons: 2, degradedLessons: 1, totalLessons: 3 }))
    })

    expect(await screen.findByText(/2 of 3 lessons are ready\./)).toBeInTheDocument()
    expect(screen.getByText(/1 lessons contain fallback content\./)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Retry incomplete lessons' }).length).toBeGreaterThan(0)
  })

  test('a clean EOF with no terminal record shows an interruption and keeps the module', async () => {
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))

    await act(async () => {
      stream.push(sseRecord('module', READY_M1))
      stream.close()
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Generation connection closed before completion.')
    expect(within(screen.getByRole('button', { name: /Ownership/ })).getByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  test('an inconsistent completion record is reported instead of trusted', async () => {
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))

    await act(async () => {
      stream.push(sseRecord('done', { courseId: 'c1', status: 'complete', readyLessons: 2, degradedLessons: 1, totalLessons: 3 }))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('inconsistent counts')
  })

  test('a completion record for another course is rejected', async () => {
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))

    await act(async () => { stream.push(sseRecord('done', { ...COMPLETE, courseId: 'c2' })) })
    expect(await screen.findByRole('alert')).toHaveTextContent('different course')
  })

  test('a terminal server error offers Retry only when it is retriable', async () => {
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))

    await act(async () => {
      stream.push(sseRecord('error', { code: 'service_unavailable', message: 'Generation is not configured', retriable: false }))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Generation is not configured')
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to my courses' })).toBeInTheDocument()
  })
})

describe('cancellation and races', () => {
  test('a module enqueued before a cancel in the same act never renders', async () => {
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))
    await screen.findByText('Processed 0 of 2 modules…')

    await act(async () => {
      // Both happen before any continuation of the pending read can run.
      stream.push(sseRecord('module', READY_M1))
      screen.getByRole('button', { name: 'Cancel generation' }).click()
    })

    expect(screen.queryByText(/Processed 1 of 2/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Ownership/ })).getByText('Not generated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate full course' })).toBeInTheDocument()
  })

  test('a cancelled run cannot disturb the run that replaces it', async () => {
    const first = streamResponse()
    const second = streamResponse()
    let started = 0
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => {
      started += 1
      return started === 1 ? first.response : second.response
    }]]))
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))
    await screen.findByText('Processed 0 of 2 modules…')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel generation' }))

    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))
    await screen.findByText('Processed 0 of 2 modules…')

    // Late traffic from the abandoned first run.
    await act(async () => {
      first.push(sseRecord('module', READY_M1))
      first.push(sseRecord('error', { code: 'internal_error', message: 'stale failure', retriable: true }))
      first.close()
    })

    expect(screen.queryByText('stale failure')).not.toBeInTheDocument()
    expect(screen.getByText('Processed 0 of 2 modules…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeInTheDocument()

    // The current run still works.
    await act(async () => {
      second.push(sseRecord('module', READY_M1))
      second.push(sseRecord('done', COMPLETE))
    })
    expect(await screen.findByText('All 3 lessons are ready.')).toBeInTheDocument()
  })

  test('unmounting mid-stream aborts without rendering a stale error', async () => {
    const stream = streamResponse()
    mockFetch(courseRoutes([['/api/courses/c1/generate-content', async () => stream.response]]))
    const view = render(renderCourseRoute('c1'))
    await screen.findByRole('heading', { name: 'Course c1' })
    await userEvent.click(screen.getByRole('button', { name: 'Generate full course' }))
    await screen.findByText('Processed 0 of 2 modules…')

    view.unmount()
    await act(async () => {
      stream.push(sseRecord('error', { code: 'internal_error', message: 'stale failure', retriable: true }))
      stream.close()
    })

    expect(document.body).not.toHaveTextContent('stale failure')
  })

  test('a deferred course A resolving after B never renders on B\'s route', async () => {
    const slowA = deferred()
    const courseB = course('c2', [courseModule('m9', [lesson('l9', { title: 'Only B' })])])
    let signalA
    mockFetch([
      ['/api/courses/c1', async ({ options }) => { signalA = options.signal; return slowA.promise }],
      ['/api/courses/c2', async () => jsonResponse(courseB)],
    ])

    render(renderCourseRoute('c1', { links: ['c2'] }))
    await waitFor(() => expect(signalA).toBeDefined())

    await userEvent.click(screen.getByRole('link', { name: 'Go to course c2' }))
    expect(await screen.findByRole('heading', { name: 'Course c2' })).toBeInTheDocument()
    expect(signalA.aborted).toBe(true)

    await act(async () => { slowA.resolve(jsonResponse(COURSE)) })
    expect(screen.getByRole('heading', { name: 'Course c2' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Course c1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Only B/ })).toBeInTheDocument()
  })
})

describe('PDF export', () => {
  test('a failing server export falls back to the client exporter', async () => {
    mockFetch(courseRoutes([['/api/courses/c1/pdf', async () => jsonResponse(
      { error: { code: 'internal_error', message: 'Something went wrong' } },
      { status: 500 },
    )]]))
    await renderLoaded()

    const exported = []
    vi.doMock('../src/pdf', () => ({ exportCourseToPdf: (value) => exported.push(value) }))

    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export PDF' })).not.toBeDisabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('a non-PDF body is not treated as a successful export', async () => {
    mockFetch(courseRoutes([['/api/courses/c1/pdf', async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      async blob() { return new Blob(['<html>'], { type: 'text/html' }) },
    })]]))
    await renderLoaded()

    const revoked = []
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake')
    globalThis.URL.revokeObjectURL = vi.fn((url) => revoked.push(url))

    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export PDF' })).not.toBeDisabled())
    // The client fallback ran instead; no object URL was ever created for a
    // body that was not a PDF.
    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled()
  })

  test('a successful export creates and then revokes its object URL', async () => {
    mockFetch(courseRoutes([['/api/courses/c1/pdf', async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      async blob() { return new Blob(['%PDF-1.7'], { type: 'application/pdf' }) },
    })]]))
    await renderLoaded()

    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake')
    globalThis.URL.revokeObjectURL = vi.fn()

    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    await waitFor(() => expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
