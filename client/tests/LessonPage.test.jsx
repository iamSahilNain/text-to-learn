import { describe, expect, test } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { deferred, jsonResponse, lesson, mockFetch, renderLessonRoute } from './helpers.jsx'

const PENDING = lesson('l1', { title: 'Ownership' })
const READY = lesson('l1', {
  title: 'Ownership',
  generationStatus: 'ready',
  objectives: ['Understand ownership'],
  content: [
    { type: 'heading', text: 'Ownership' },
    { type: 'paragraph', text: 'Rust tracks who owns each value.' },
    { type: 'mcq', question: 'Who owns it?', options: ['s', 'nobody'], answer: 0, explanation: 'It moves.' },
  ],
})
const DEGRADED = lesson('l1', {
  title: 'Ownership',
  generationStatus: 'degraded',
  content: [
    { type: 'heading', text: 'Ownership' },
    { type: 'paragraph', text: 'This lesson could not be generated right now. Please try again.' },
  ],
})

const FALLBACK_NOTICE = 'Fallback content — generation could not complete.'

describe('loading and error states', () => {
  test('a 404 renders its own missing-resource message', async () => {
    mockFetch([['/api/lessons/l1', async () => jsonResponse(
      { error: { code: 'not_found', message: 'Lesson not found' } },
      { status: 404 },
    )]])
    render(renderLessonRoute('l1'))
    expect(await screen.findByText('Lesson not found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument()
  })

  test('a load failure is retryable and a successful retry replaces it', async () => {
    let attempts = 0
    mockFetch([['/api/lessons/l1', async () => {
      attempts += 1
      return attempts === 1
        ? jsonResponse({ error: { code: 'internal_error', message: 'Something went wrong' } }, { status: 500 })
        : jsonResponse(READY)
    }]])

    render(renderLessonRoute('l1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Ownership', level: 1 })).toBeInTheDocument()
  })
})

describe('generation by status', () => {
  test('a pending lesson offers Generate Lesson Content', async () => {
    mockFetch([['/api/lessons/l1', async () => jsonResponse(PENDING)]])
    render(renderLessonRoute('l1'))
    expect(await screen.findByRole('button', { name: 'Generate Lesson Content' })).toBeInTheDocument()
  })

  test('a degraded lesson renders its content and still offers a retry', async () => {
    mockFetch([['/api/lessons/l1', async () => jsonResponse(DEGRADED)]])
    render(renderLessonRoute('l1'))

    expect(await screen.findByText(FALLBACK_NOTICE)).toBeInTheDocument()
    expect(screen.getByText('This lesson could not be generated right now. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry generation' })).toBeInTheDocument()
  })

  test('a ready result clears the fallback warning and its retry button', async () => {
    mockFetch([
      ['/api/lessons/l1/generate', async () => jsonResponse(READY)],
      ['/api/lessons/l1', async () => jsonResponse(DEGRADED)],
    ])
    render(renderLessonRoute('l1'))
    await screen.findByText(FALLBACK_NOTICE)

    await userEvent.click(screen.getByRole('button', { name: 'Retry generation' }))
    await waitFor(() => expect(screen.queryByText(FALLBACK_NOTICE)).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Retry generation' })).not.toBeInTheDocument()
    expect(screen.getByText('Rust tracks who owns each value.')).toBeInTheDocument()
  })

  test('a second degraded result keeps the warning and the retry button', async () => {
    mockFetch([
      ['/api/lessons/l1/generate', async () => jsonResponse(DEGRADED)],
      ['/api/lessons/l1', async () => jsonResponse(DEGRADED)],
    ])
    render(renderLessonRoute('l1'))
    await screen.findByText(FALLBACK_NOTICE)

    await userEvent.click(screen.getByRole('button', { name: 'Retry generation' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry generation' })).not.toBeDisabled())
    expect(screen.getByText(FALLBACK_NOTICE)).toBeInTheDocument()
  })

  test('generation requests force:false', async () => {
    const fetchMock = mockFetch([
      ['/api/lessons/l1/generate', async () => jsonResponse(READY)],
      ['/api/lessons/l1', async () => jsonResponse(PENDING)],
    ])
    render(renderLessonRoute('l1'))
    await screen.findByRole('button', { name: 'Generate Lesson Content' })

    await userEvent.click(screen.getByRole('button', { name: 'Generate Lesson Content' }))
    await screen.findByText('Rust tracks who owns each value.')

    const generateCall = fetchMock.calls.find((call) => call.path.endsWith('/generate'))
    expect(JSON.parse(generateCall.options.body)).toEqual({ force: false })
  })

  test('a ready lesson with no videos is still ready', async () => {
    mockFetch([['/api/lessons/l1', async () => jsonResponse({ ...READY, videos: [], enrichmentStatus: 'unavailable' })]])
    render(renderLessonRoute('l1'))
    await screen.findByText('Rust tracks who owns each value.')
    expect(screen.queryByText(FALLBACK_NOTICE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry generation/ })).not.toBeInTheDocument()
  })
})

describe('failed regeneration', () => {
  test('a 502 leaves the lesson intact and shows a visible alert', async () => {
    mockFetch([
      ['/api/lessons/l1/generate', async () => jsonResponse(
        { error: { code: 'upstream_unavailable', message: 'Generation provider is unavailable' } },
        { status: 502 },
      )],
      ['/api/lessons/l1', async () => jsonResponse(READY)],
    ])
    render(renderLessonRoute('l1'))
    await screen.findByText('Rust tracks who owns each value.')

    // A ready lesson has no generate control, so drive the degraded path.
    mockFetch([
      ['/api/lessons/l1/generate', async () => jsonResponse(
        { error: { code: 'upstream_unavailable', message: 'Generation provider is unavailable' } },
        { status: 502 },
      )],
      ['/api/lessons/l1', async () => jsonResponse(DEGRADED)],
    ])
    render(renderLessonRoute('l1'))
    const notices = await screen.findAllByText(FALLBACK_NOTICE)
    expect(notices.length).toBeGreaterThan(0)

    await userEvent.click(screen.getAllByRole('button', { name: 'Retry generation' })[0])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Generation provider is unavailable')
    // Title, objectives, blocks and the retry affordance all survive.
    expect(screen.getAllByRole('heading', { name: 'Ownership', level: 1 }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('This lesson could not be generated right now. Please try again.').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Retry generation' }).length).toBeGreaterThan(0)
  })

  test('a successful response for a different lesson is rejected', async () => {
    mockFetch([
      ['/api/lessons/l1/generate', async () => jsonResponse({ ...READY, _id: 'l9' })],
      ['/api/lessons/l1', async () => jsonResponse(PENDING)],
    ])
    render(renderLessonRoute('l1'))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Lesson Content' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected lesson')
    expect(screen.getByRole('button', { name: 'Generate Lesson Content' })).toBeInTheDocument()
  })

  test('repeated clicks before the first response produce exactly one request', async () => {
    const slow = deferred()
    const fetchMock = mockFetch([
      ['/api/lessons/l1/generate', async () => slow.promise],
      ['/api/lessons/l1', async () => jsonResponse(PENDING)],
    ])
    render(renderLessonRoute('l1'))
    const button = await screen.findByRole('button', { name: 'Generate Lesson Content' })

    button.click()
    button.click()
    button.click()

    expect(fetchMock.calls.filter((call) => call.path.endsWith('/generate'))).toHaveLength(1)
    slow.resolve(jsonResponse(READY))
    await screen.findByText('Rust tracks who owns each value.')
  })
})

describe('route lifecycle', () => {
  test('MCQ selections do not leak between lessons', async () => {
    const other = lesson('l2', {
      title: 'Borrowing',
      generationStatus: 'ready',
      content: [{ type: 'mcq', question: 'Who owns it?', options: ['s', 'nobody'], answer: 0, explanation: 'It moves.' }],
    })
    mockFetch([
      ['/api/lessons/l1', async () => jsonResponse(READY)],
      ['/api/lessons/l2', async () => jsonResponse(other)],
    ])

    render(renderLessonRoute('l1', { links: ['l2'] }))
    await screen.findByText('Rust tracks who owns each value.')
    await userEvent.click(screen.getByRole('button', { name: '1. s' }))
    expect(screen.getByText('Correct!')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Go to lesson l2' }))
    expect(await screen.findByRole('heading', { name: 'Borrowing', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('Correct!')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1. s' })).toBeEnabled()
  })

  test('a deferred lesson A resolving after B never renders on B\'s route', async () => {
    const slowA = deferred()
    let signalA
    mockFetch([
      ['/api/lessons/l1', async ({ options }) => { signalA = options.signal; return slowA.promise }],
      ['/api/lessons/l2', async () => jsonResponse(lesson('l2', { title: 'Borrowing', generationStatus: 'ready', content: [{ type: 'paragraph', text: 'Only B.' }] }))],
    ])

    render(renderLessonRoute('l1', { links: ['l2'] }))
    await waitFor(() => expect(signalA).toBeDefined())
    await userEvent.click(screen.getByRole('link', { name: 'Go to lesson l2' }))
    expect(await screen.findByText('Only B.')).toBeInTheDocument()
    expect(signalA.aborted).toBe(true)

    slowA.resolve(jsonResponse(READY))
    await waitFor(() => expect(screen.getByText('Only B.')).toBeInTheDocument())
    expect(screen.queryByText('Rust tracks who owns each value.')).not.toBeInTheDocument()
  })

  test('a video card renders for a ready enriched lesson', async () => {
    mockFetch([['/api/lessons/l1', async () => jsonResponse({
      ...READY,
      enrichmentStatus: 'ok',
      videos: [{ videoId: 'v1', title: 'Ownership talk', channel: 'Rust', thumbnail: '', url: 'https://example.test/v1' }],
    })]])
    render(renderLessonRoute('l1'))
    const link = await screen.findByRole('link', { name: /Ownership talk/ })
    expect(within(link).getByText('Rust')).toBeInTheDocument()
  })
})
