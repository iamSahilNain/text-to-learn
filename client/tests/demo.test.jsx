import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { DemoCourseRoute, DemoLessonRoute } from '../src/App'
import { DEMO_COURSE, demoLessonPath, getAdjacentDemoLessons } from '../src/demo/demoData'
import { tokenizeInlineText } from '../src/inlineTextTokenizer'
import { mockFetch } from './helpers.jsx'

// Mirrors how InlineText actually renders a string (single-backtick spans
// become <code>, but the visible text content is unchanged either way), so
// a question containing an inline-code span can still be matched exactly.
function renderedText(text) {
  return tokenizeInlineText(text).map((token) => token.text).join('')
}

function renderDemo(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/demo/:courseSlug" element={<DemoCourseRoute />} />
        <Route path="/demo/:courseSlug/lessons/:lessonSlug" element={<DemoLessonRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

const ALL_LESSONS = DEMO_COURSE.modules.flatMap((courseModule) => courseModule.lessons)

describe('demo course', () => {
  test('renders the sample course with every lesson ready', async () => {
    mockFetch([])
    renderDemo('/demo/react-fundamentals')

    expect(await screen.findByRole('heading', { name: 'React Fundamentals', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(`${ALL_LESSONS.length} of ${ALL_LESSONS.length} lessons ready`)).toBeInTheDocument()
    for (const lesson of ALL_LESSONS) {
      expect(screen.getByRole('button', { name: new RegExp(lesson.title) })).toBeInTheDocument()
    }
  })

  test('an unknown course slug shows a not-found view with a return link', async () => {
    mockFetch([])
    renderDemo('/demo/nope')
    expect(await screen.findByText("That page doesn't exist in this sample.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back home' })).toBeInTheDocument()
  })

  test('demo browsing makes no network request', async () => {
    const fetchMock = mockFetch([])
    renderDemo('/demo/react-fundamentals')
    await screen.findByRole('heading', { name: 'React Fundamentals', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: new RegExp(ALL_LESSONS[0].title) }))
    await screen.findByRole('heading', { name: ALL_LESSONS[0].title, level: 1 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('PDF export failure shows a visible retryable message', async () => {
    mockFetch([])
    vi.doMock('../src/pdf', () => ({
      exportCourseToPdf: () => { throw new Error('boom') },
    }))
    renderDemo('/demo/react-fundamentals')
    await screen.findByRole('heading', { name: 'React Fundamentals', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF export failed')
  })
})

describe('demo lessons', () => {
  for (const lesson of ALL_LESSONS) {
    test(`${lesson.title} renders complete content`, async () => {
      mockFetch([])
      renderDemo(demoLessonPath(lesson))

      expect(await screen.findByRole('heading', { name: lesson.title, level: 1 })).toBeInTheDocument()
      // Every fixture lesson carries objectives, at least one code block, and
      // one MCQ -- this is the deterministic-content acceptance check.
      expect(screen.getByText('Learning objectives')).toBeInTheDocument()
      const mcqBlock = lesson.content.find((block) => block.type === 'mcq')
      // getByText's default matcher only reads a node's own direct text-node
      // children, so a question containing an inline-code span (split across
      // sibling nodes) needs the full element textContent checked instead.
      expect(
        screen.getByText(
          (_, element) => element.tagName === 'P' && element.textContent === renderedText(mcqBlock.question),
        ),
      ).toBeInTheDocument()
    })
  }

  test('an unknown lesson slug shows a not-found view scoped to the sample', async () => {
    mockFetch([])
    renderDemo('/demo/react-fundamentals/lessons/does-not-exist')
    expect(await screen.findByText("That lesson doesn't exist in this sample.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sample course' })).toBeInTheDocument()
  })

  test('a real lesson slug under the wrong course slug is not found, not silently resolved', async () => {
    mockFetch([])
    const realLesson = ALL_LESSONS[0]
    renderDemo(`/demo/wrong-course/lessons/${realLesson.slug}`)
    expect(await screen.findByText("That lesson doesn't exist in this sample.")).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: realLesson.title, level: 1 })).not.toBeInTheDocument()
  })

  test('the right course slug with the right lesson slug resolves normally', async () => {
    mockFetch([])
    const realLesson = ALL_LESSONS[0]
    renderDemo(`/demo/react-fundamentals/lessons/${realLesson.slug}`)
    expect(await screen.findByRole('heading', { name: realLesson.title, level: 1 })).toBeInTheDocument()
  })

  test('quiz selections reset when navigating to the next lesson', async () => {
    mockFetch([])
    const [first, second] = ALL_LESSONS
    renderDemo(demoLessonPath(first))
    await screen.findByRole('heading', { name: first.title, level: 1 })

    const firstMcq = first.content.find((block) => block.type === 'mcq')
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^1\\. ${firstMcq.options[0]}`) }))
    expect(screen.getByText(/Correct!|Not quite\./)).toBeInTheDocument()

    // The course outline sidebar also links every lesson, so scope to the
    // Previous/Next region specifically.
    const lessonNav = screen.getByRole('navigation', { name: 'Lesson navigation' })
    await userEvent.click(within(lessonNav).getByRole('link', { name: new RegExp(second.title) }))
    await waitFor(() => expect(screen.getByRole('heading', { name: second.title, level: 1 })).toBeInTheDocument())
    expect(screen.queryByText(/Correct!|Not quite\./)).not.toBeInTheDocument()
  })

  test('Previous is absent on the first lesson and Next is absent on the last', async () => {
    mockFetch([])
    const firstLesson = ALL_LESSONS[0]
    const lastLesson = ALL_LESSONS[ALL_LESSONS.length - 1]

    const firstView = renderDemo(demoLessonPath(firstLesson))
    await screen.findByRole('heading', { name: firstLesson.title, level: 1 })
    expect(getAdjacentDemoLessons(firstLesson.slug).previous).toBeNull()
    const { next: firstNext } = getAdjacentDemoLessons(firstLesson.slug)
    let lessonNav = screen.getByRole('navigation', { name: 'Lesson navigation' })
    expect(within(lessonNav).queryByRole('link', { name: /Previous/ })).not.toBeInTheDocument()
    expect(within(lessonNav).getByRole('link', { name: new RegExp(firstNext.title) })).toBeInTheDocument()
    firstView.unmount()

    renderDemo(demoLessonPath(lastLesson))
    await screen.findByRole('heading', { name: lastLesson.title, level: 1 })
    const { previous: lastPrevious, next: lastNext } = getAdjacentDemoLessons(lastLesson.slug)
    lessonNav = screen.getByRole('navigation', { name: 'Lesson navigation' })
    expect(within(lessonNav).getByRole('link', { name: new RegExp(lastPrevious.title) })).toBeInTheDocument()
    expect(within(lessonNav).queryByRole('link', { name: /Next/ })).not.toBeInTheDocument()
    expect(lastNext).toBeNull()
  })
})
