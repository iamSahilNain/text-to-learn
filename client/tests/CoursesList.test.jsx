import { StrictMode } from 'react'
import { describe, expect, test } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import CoursesList from '../src/pages/CoursesList'
import { deferred, jsonResponse, mockFetch } from './helpers.jsx'

const PAGE_SIZE = 20

function renderList() {
  return render(
    <StrictMode>
    <MemoryRouter initialEntries={['/courses']}>
      <Routes>
        <Route path="/courses" element={<CoursesList />} />
        <Route path="/course/:courseId" element={<p>Course page</p>} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>
    </StrictMode>,
  )
}

// The server holds `total` courses; this mimics its paging exactly, one
// extra record and all.
function pagedBackend(total) {
  const all = Array.from({ length: total }, (_, index) => ({
    _id: `c${index + 1}`,
    title: `Course ${index + 1}`,
    description: '',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  }))
  return ({ path }) => {
    const params = new URLSearchParams(path.split('?')[1])
    const page = Number(params.get('page'))
    const limit = Number(params.get('limit'))
    const skip = (page - 1) * limit
    const fetched = all.slice(skip, skip + limit + 1)
    const hasMore = fetched.length > limit
    return jsonResponse({
      courses: hasMore ? fetched.slice(0, limit) : fetched,
      page,
      pageSize: limit,
      hasMore,
    })
  }
}

async function renderWithTotal(total) {
  const fetchMock = mockFetch([[/^\/api\/courses\?/, pagedBackend(total)]])
  renderList()
  await waitFor(() => expect(screen.queryByText('Loading courses...')).not.toBeInTheDocument())
  return fetchMock
}

function cardTitles() {
  return screen.getAllByRole('button')
    .map((button) => button.textContent)
    .filter((text) => text.startsWith('Course '))
}

describe('paging boundaries', () => {
  test('the first request is always explicit about page and limit', async () => {
    const fetchMock = await renderWithTotal(1)
    expect(fetchMock.calls[0].path).toBe(`/api/courses?page=1&limit=${PAGE_SIZE}`)
  })

  test('an empty first page shows the empty state and no Next', async () => {
    await renderWithTotal(0)
    expect(screen.getByText('No courses yet — generate one from the home page.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  for (const total of [1, 19, 20]) {
    test(`${total} records fit one page and offer no Next`, async () => {
      await renderWithTotal(total)
      expect(cardTitles()).toHaveLength(total)
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
  }

  for (const [total, secondPageCount] of [[21, 1], [40, 20]]) {
    test(`${total} records page into ${secondPageCount} on page two`, async () => {
      const fetchMock = await renderWithTotal(total)
      expect(cardTitles()).toHaveLength(PAGE_SIZE)
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
      await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument())

      expect(fetchMock.calls.at(-1).path).toBe(`/api/courses?page=2&limit=${PAGE_SIZE}`)
      // The page replaces the cards rather than appending to them.
      expect(cardTitles()).toHaveLength(secondPageCount)
      expect(cardTitles()[0]).toContain('Course 21')
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

      await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
      await waitFor(() => expect(screen.getByText('Page 1')).toBeInTheDocument())
      expect(cardTitles()[0]).toContain('Course 1')
    })
  }

  test('41 records reach a third page', async () => {
    await renderWithTotal(41)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText('Page 3')).toBeInTheDocument())
    expect(cardTitles()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  test('a page that became empty says so and keeps Previous available', async () => {
    mockFetch([[/^\/api\/courses\?/, ({ path }) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'))
      if (page === 1) {
        return pagedBackend(21)({ path })
      }
      return jsonResponse({ courses: [], page, pageSize: PAGE_SIZE, hasMore: false })
    }]])
    renderList()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText('No courses on this page.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
  })
})

describe('failures and races', () => {
  test('a failed page two keeps page one and retries exactly that page', async () => {
    let secondPageAttempts = 0
    const fetchMock = mockFetch([[/^\/api\/courses\?/, ({ path }) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'))
      if (page === 1) return pagedBackend(21)({ path })
      secondPageAttempts += 1
      if (secondPageAttempts === 1) {
        return jsonResponse({ error: { code: 'internal_error', message: 'Something went wrong' } }, { status: 500 })
      }
      return pagedBackend(21)({ path })
    }]])
    renderList()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    // The successful page is not advanced by a failure.
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(cardTitles()).toHaveLength(PAGE_SIZE)

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument())

    const pageTwoRequests = fetchMock.calls.filter((call) => call.path.includes('page=2'))
    expect(pageTwoRequests).toHaveLength(2)
  })

  test('rapid Next clicks produce exactly one request', async () => {
    const slow = deferred()
    const fetchMock = mockFetch([[/^\/api\/courses\?/, ({ path }) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'))
      return page === 1 ? pagedBackend(41)({ path }) : slow.promise
    }]])
    renderList()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())

    const next = screen.getByRole('button', { name: 'Next' })
    next.click()
    next.click()
    next.click()

    expect(fetchMock.calls.filter((call) => call.path.includes('page=2'))).toHaveLength(1)
    slow.resolve(jsonResponse({ courses: [], page: 2, pageSize: PAGE_SIZE, hasMore: false }))
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument())
  })

  test('a mismatched or malformed envelope is rejected', async () => {
    for (const payload of [
      { courses: [], page: 5, pageSize: PAGE_SIZE, hasMore: false },
      { courses: [], page: 1, pageSize: 10, hasMore: false },
      { courses: [], page: 1, pageSize: PAGE_SIZE, hasMore: 'no' },
      [{ _id: 'c1', title: 'Course 1' }],
    ]) {
      mockFetch([[/^\/api\/courses\?/, async () => jsonResponse(payload)]])
      const view = renderList()
      expect(await screen.findByRole('alert')).toHaveTextContent('unexpected course list')
      view.unmount()
    }
  })

  test('an invalid pagination error from the server is shown', async () => {
    mockFetch([[/^\/api\/courses\?/, async () => jsonResponse(
      { error: { code: 'invalid_pagination', message: 'page and limit must be valid positive integers' } },
      { status: 400 },
    )]])
    renderList()
    expect(await screen.findByRole('alert')).toHaveTextContent('page and limit must be valid positive integers')
  })

  test('unmounting mid-request aborts it', async () => {
    let signal
    mockFetch([[/^\/api\/courses\?/, async ({ options }) => {
      signal = options.signal
      return deferred().promise
    }]])
    const view = renderList()
    await waitFor(() => expect(signal).toBeDefined())
    view.unmount()
    expect(signal.aborted).toBe(true)
  })
})
