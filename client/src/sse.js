import { ApiError } from './api'

// The production reader for the course generation stream. CoursePage and the
// tests use this same code, so a parsing rule proved in a test is the rule
// the application actually runs.

const LESSON_STATUSES = ['pending', 'ready', 'degraded']
const DONE_STATUSES = ['complete', 'degraded']

function invalid(detail) {
  return new ApiError(detail, { code: 'invalid_response' })
}

// One `event:`/`data:` record, already split on the blank line between
// records. Multiple data lines join with a newline, per the SSE format.
function parseRecord(raw) {
  let event = 'message'
  const dataLines = []
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue // comment or heartbeat frame
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  return { event, data: dataLines.join('\n') }
}

function isValidStreamedModule(courseModule) {
  return (
    courseModule !== null &&
    typeof courseModule === 'object' &&
    typeof courseModule._id === 'string' &&
    courseModule._id.length > 0 &&
    Array.isArray(courseModule.lessons) &&
    courseModule.lessons.every(
      (lesson) => typeof lesson?._id === 'string' && LESSON_STATUSES.includes(lesson.generationStatus),
    )
  )
}

function isValidSummary(summary) {
  return (
    summary !== null &&
    typeof summary === 'object' &&
    typeof summary.courseId === 'string' &&
    DONE_STATUSES.includes(summary.status) &&
    Number.isInteger(summary.readyLessons) &&
    Number.isInteger(summary.degradedLessons) &&
    Number.isInteger(summary.totalLessons)
  )
}

function isValidStreamError(payload) {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    typeof payload.code === 'string' &&
    typeof payload.message === 'string' &&
    typeof payload.retriable === 'boolean'
  )
}

/**
 * Consume one course-generation stream.
 *
 * Resolves once a terminal `done` or `error` record has been delivered.
 * Throws ApiError for a bad response, an unparseable record, or a stream
 * that ends without a terminal record -- the number of module records
 * received is never treated as proof of completion.
 *
 * `isCurrent()` is re-checked after every read and before every callback,
 * because a read that resolved before a cancel still delivers its value.
 */
export async function consumeCourseEvents(response, { isCurrent, onModule, onDone, onError }) {
  if (!response.ok) {
    let envelope
    try {
      envelope = (await response.json())?.error
    } catch {
      // A non-JSON error body (a proxy's HTML page, say) carries no envelope.
    }
    throw new ApiError(
      envelope?.message || `Generation failed to start (HTTP ${response.status})`,
      { status: response.status, code: envelope?.code || 'request_failed' },
    )
  }

  const contentType = response.headers?.get?.('content-type') || ''
  if (!contentType.includes('text/event-stream')) throw invalid('response to a generation request.')
  if (!response.body) throw invalid('empty response to a generation request.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false

  function deliver(raw) {
    const { event, data } = parseRecord(raw)
    if (event !== 'module' && event !== 'done' && event !== 'error') return

    let payload
    try {
      payload = JSON.parse(data)
    } catch {
      throw invalid(`${event} record.`)
    }

    if (event === 'module') {
      if (!isValidStreamedModule(payload)) throw invalid('module record.')
      if (!isCurrent()) return
      onModule(payload)
      return
    }

    if (event === 'done') {
      if (!isValidSummary(payload)) throw invalid('completion record.')
      terminal = true
      if (isCurrent()) onDone(payload)
      return
    }

    if (!isValidStreamError(payload)) throw invalid('error record.')
    terminal = true
    // A reported application error ends the run through its callback; it is
    // not raised again as an exception.
    if (isCurrent()) onError(payload)
  }

  try {
    while (!terminal) {
      const { done, value } = await reader.read()
      // The read may have resolved before a cancel landed.
      if (!isCurrent()) return
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let boundary = findBoundary(buffer)
      while (boundary) {
        const raw = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        deliver(raw)
        if (terminal || !isCurrent()) return
        boundary = findBoundary(buffer)
      }
    }

    if (!terminal) {
      throw new ApiError('Generation connection closed before completion. Retry to continue.', {
        code: 'stream_interrupted',
      })
    }
  } finally {
    // Cleanup failures must not replace the error that actually mattered.
    try {
      await reader.cancel()
    } catch {
      // ignored
    }
    try {
      reader.releaseLock()
    } catch {
      // ignored
    }
  }
}

// Records are separated by a blank line, in either LF or CRLF form.
function findBoundary(buffer) {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}
