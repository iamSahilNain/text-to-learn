// Production serves the browser app and API from the same origin.
export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001')

const LESSON_STATUSES = ['pending', 'ready', 'degraded']
const OUTLINE_STATUSES = ['ready', 'degraded']

// Codes that describe something the request itself got wrong, or a server
// that is not configured. Repeating the same request cannot help.
const NON_RETRIABLE_CODES = new Set([
  'unauthorized',
  'invalid_topic',
  'bad_id',
  'invalid_request',
  'invalid_json',
  'invalid_pagination',
  'not_found',
  'service_unavailable',
])

export class ApiError extends Error {
  constructor(message, { status, code, retriable } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retriable = retriable ?? !NON_RETRIABLE_CODES.has(code)
  }
}

/**
 * fetch + JSON + the shared { error: { code, message } } envelope.
 *
 * A non-2xx response, and a 2xx response that carries an error envelope or
 * cannot be decoded, both throw ApiError. A native AbortError passes through
 * untouched: a cancelled request is not a failure to show the user.
 */
export async function fetchJson(path, options = {}) {
  const response = await fetch(API_URL + path, options)

  let body
  let decodable = true
  try {
    body = await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    decodable = false
  }

  const envelope = decodable && body && typeof body === 'object' ? body.error : null

  if (!response.ok) {
    // A proxy's HTML error page has no envelope; report the status instead
    // of showing markup to the user.
    throw new ApiError(
      envelope?.message || `Request failed (HTTP ${response.status})`,
      { status: response.status, code: envelope?.code || 'request_failed' },
    )
  }

  if (!decodable) {
    throw new ApiError('The server sent a response that could not be read.', {
      status: response.status,
      code: 'invalid_response',
    })
  }

  // A 200 carrying an error envelope is still a failure.
  if (envelope) {
    throw new ApiError(envelope.message || 'Request failed', {
      status: response.status,
      code: envelope.code || 'request_failed',
    })
  }

  return body
}

export function invalidResponse(what) {
  return new ApiError(`The server sent an unexpected ${what}.`, { code: 'invalid_response' })
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

export function isValidLesson(lesson) {
  return (
    lesson !== null &&
    typeof lesson === 'object' &&
    isNonEmptyString(lesson._id) &&
    typeof lesson.title === 'string' &&
    Array.isArray(lesson.content) &&
    LESSON_STATUSES.includes(lesson.generationStatus)
  )
}

export function isValidModule(courseModule) {
  return (
    courseModule !== null &&
    typeof courseModule === 'object' &&
    isNonEmptyString(courseModule._id) &&
    Array.isArray(courseModule.lessons) &&
    courseModule.lessons.every(isValidLesson)
  )
}

export function isValidCourse(course) {
  return (
    course !== null &&
    typeof course === 'object' &&
    isNonEmptyString(course._id) &&
    typeof course.title === 'string' &&
    Array.isArray(course.modules) &&
    OUTLINE_STATUSES.includes(course.outlineStatus) &&
    course.modules.every(isValidModule)
  )
}

export function isValidCourseList(payload, { page, pageSize }) {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    Array.isArray(payload.courses) &&
    payload.courses.every((course) => isNonEmptyString(course?._id) && typeof course.title === 'string') &&
    isPositiveInteger(payload.page) &&
    isPositiveInteger(payload.pageSize) &&
    typeof payload.hasMore === 'boolean' &&
    payload.page === page &&
    payload.pageSize === pageSize
  )
}
