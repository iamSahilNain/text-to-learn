import { describe, expect, test, vi } from 'vitest'
import { ApiError, fetchJson, isValidCourse, isValidCourseList, isValidLesson } from '../src/api'
import { API_URL, jsonResponse, nonJsonResponse, course, courseModule, lesson } from './helpers.jsx'

describe('fetchJson', () => {
  test('returns the decoded body of a successful response', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ _id: 'c1' }))
    await expect(fetchJson('/api/courses/c1')).resolves.toEqual({ _id: 'c1' })
    expect(globalThis.fetch).toHaveBeenCalledWith(`${API_URL}/api/courses/c1`, {})
  })

  test('turns an error envelope into a typed ApiError', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(
      { error: { code: 'not_found', message: 'Course not found' } },
      { status: 404 },
    ))

    const error = await fetchJson('/api/courses/missing').catch((err) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(404)
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('Course not found')
    expect(error.retriable).toBe(false)
  })

  test('reports an HTML error page by status instead of showing markup', async () => {
    globalThis.fetch = vi.fn(async () => nonJsonResponse({ status: 502 }))

    const error = await fetchJson('/api/courses/c1').catch((err) => err)
    expect(error.code).toBe('request_failed')
    expect(error.message).toBe('Request failed (HTTP 502)')
    expect(error.message).not.toContain('<html>')
    expect(error.retriable).toBe(true)
  })

  test('a 200 carrying an error envelope is still a failure', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: { code: 'internal_error', message: 'Something went wrong' } }))

    const error = await fetchJson('/api/courses/c1').catch((err) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('internal_error')
  })

  test('a 200 that cannot be decoded is a retriable invalid_response', async () => {
    globalThis.fetch = vi.fn(async () => nonJsonResponse())

    const error = await fetchJson('/api/courses/c1').catch((err) => err)
    expect(error.code).toBe('invalid_response')
    expect(error.retriable).toBe(true)
  })

  test('a native AbortError passes through unchanged', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    globalThis.fetch = vi.fn(async () => { throw abort })

    await expect(fetchJson('/api/courses/c1')).rejects.toBe(abort)
  })

  test('the caller\'s options, including its signal, are forwarded', async () => {
    const controller = new AbortController()
    globalThis.fetch = vi.fn(async () => jsonResponse({}))
    await fetchJson('/api/courses/c1', { method: 'POST', signal: controller.signal })
    expect(globalThis.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', signal: controller.signal })
  })

  test('non-retriable codes are marked as such', async () => {
    for (const code of ['invalid_topic', 'bad_id', 'invalid_request', 'invalid_json', 'invalid_pagination', 'not_found', 'service_unavailable']) {
      globalThis.fetch = vi.fn(async () => jsonResponse({ error: { code, message: 'no' } }, { status: 400 }))
      const error = await fetchJson('/x').catch((err) => err)
      expect(error.retriable, code).toBe(false)
    }
  })
})

describe('response shape validation', () => {
  test('a course needs an id, a title, an outline status and valid modules', () => {
    expect(isValidCourse(course('c1', [courseModule('m1', [lesson('l1')])]))).toBe(true)
    expect(isValidCourse({ ...course('c1', []), outlineStatus: undefined })).toBe(false)
    expect(isValidCourse({ ...course('c1', []), _id: '' })).toBe(false)
    expect(isValidCourse({ error: { code: 'not_found', message: 'x' } })).toBe(false)
    expect(isValidCourse(course('c1', [courseModule('m1', [{ ...lesson('l1'), generationStatus: undefined }])]))).toBe(false)
  })

  test('a lesson without a valid generation status is rejected', () => {
    expect(isValidLesson(lesson('l1'))).toBe(true)
    expect(isValidLesson({ ...lesson('l1'), generationStatus: 'generating' })).toBe(false)
    expect(isValidLesson({ ...lesson('l1'), content: undefined })).toBe(false)
  })

  test('a list envelope must match the page that was asked for', () => {
    const payload = { courses: [{ _id: 'c1', title: 'One' }], page: 2, pageSize: 20, hasMore: false }
    expect(isValidCourseList(payload, { page: 2, pageSize: 20 })).toBe(true)
    expect(isValidCourseList(payload, { page: 1, pageSize: 20 })).toBe(false)
    expect(isValidCourseList({ ...payload, pageSize: 10 }, { page: 2, pageSize: 20 })).toBe(false)
    expect(isValidCourseList({ ...payload, hasMore: 'yes' }, { page: 2, pageSize: 20 })).toBe(false)
    expect(isValidCourseList([{ _id: 'c1' }], { page: 1, pageSize: 20 })).toBe(false)
  })
})
