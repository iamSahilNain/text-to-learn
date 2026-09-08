import { StrictMode } from 'react'
import { describe, expect, test } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import Home from '../src/pages/Home'
import { deferred, jsonResponse, mockFetch } from './helpers.jsx'

function renderHome() {
  return render(
    <StrictMode>
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/course/:courseId" element={<p>Course page</p>} />
        <Route path="/courses" element={<p>My Courses</p>} />
      </Routes>
    </MemoryRouter>
    </StrictMode>,
  )
}

describe('Home', () => {
  test('submits the trimmed topic once and navigates', async () => {
    const fetchMock = mockFetch([['/api/courses/generate', async () => jsonResponse({ _id: 'c1' })]])
    renderHome()

    await userEvent.type(screen.getByLabelText('Topic'), '  Rust ownership  ')
    await userEvent.click(screen.getByRole('button', { name: 'Generate Course' }))

    expect(await screen.findByText('Course page')).toBeInTheDocument()
    expect(fetchMock.calls).toHaveLength(1)
    expect(JSON.parse(fetchMock.calls[0].options.body)).toEqual({ topic: 'Rust ownership' })
  })

  test('repeated Enter presses before the first response produce one request', async () => {
    const slow = deferred()
    const fetchMock = mockFetch([['/api/courses/generate', async () => slow.promise]])
    renderHome()

    const input = screen.getByLabelText('Topic')
    await userEvent.type(input, 'Rust')
    await userEvent.type(input, '{Enter}{Enter}{Enter}')

    expect(fetchMock.calls).toHaveLength(1)
    slow.resolve(jsonResponse({ _id: 'c1' }))
    expect(await screen.findByText('Course page')).toBeInTheDocument()
  })

  test('repeated clicks before React re-renders produce one request', async () => {
    const slow = deferred()
    const fetchMock = mockFetch([['/api/courses/generate', async () => slow.promise]])
    renderHome()

    await userEvent.type(screen.getByLabelText('Topic'), 'Rust')
    const button = screen.getByRole('button', { name: 'Generate Course' })
    button.click()
    button.click()
    button.click()

    expect(fetchMock.calls).toHaveLength(1)
    slow.resolve(jsonResponse({ _id: 'c1' }))
    await screen.findByText('Course page')
  })

  test('an empty or whitespace-only topic sends nothing', async () => {
    const fetchMock = mockFetch([['/api/courses/generate', async () => jsonResponse({ _id: 'c1' })]])
    renderHome()

    await userEvent.click(screen.getByRole('button', { name: 'Generate Course' }))
    await userEvent.type(screen.getByLabelText('Topic'), '   {Enter}')
    expect(fetchMock.calls).toHaveLength(0)
  })

  test('a failure restores the controls and permits exactly one retry', async () => {
    let attempts = 0
    const fetchMock = mockFetch([['/api/courses/generate', async () => {
      attempts += 1
      return attempts === 1
        ? jsonResponse({ error: { code: 'upstream_unavailable', message: 'Generation provider is unavailable' } }, { status: 502 })
        : jsonResponse({ _id: 'c1' })
    }]])
    renderHome()

    await userEvent.type(screen.getByLabelText('Topic'), 'Rust')
    await userEvent.click(screen.getByRole('button', { name: 'Generate Course' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Generation provider is unavailable')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Course' })).not.toBeDisabled())
    expect(screen.getByLabelText('Topic')).not.toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Generate Course' }))
    expect(await screen.findByText('Course page')).toBeInTheDocument()
    expect(fetchMock.calls).toHaveLength(2)
  })

  test('a successful response without a usable id does not navigate', async () => {
    mockFetch([['/api/courses/generate', async () => jsonResponse({ title: 'Rust' })]])
    renderHome()

    await userEvent.type(screen.getByLabelText('Topic'), 'Rust')
    await userEvent.click(screen.getByRole('button', { name: 'Generate Course' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected course')
    expect(screen.queryByText('Course page')).not.toBeInTheDocument()
  })

  test('leaving Home before the response lands prevents navigation', async () => {
    const slow = deferred()
    mockFetch([['/api/courses/generate', async () => slow.promise]])
    const view = renderHome()

    await userEvent.type(screen.getByLabelText('Topic'), 'Rust')
    await userEvent.click(screen.getByRole('button', { name: 'Generate Course' }))

    view.unmount()
    slow.resolve(jsonResponse({ _id: 'c1' }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(document.body).not.toHaveTextContent('Course page')
  })
})
