import { describe, expect, test } from 'vitest'
import { consumeCourseEvents } from '../src/sse'
import { jsonResponse, sseRecord, streamResponse } from './helpers.jsx'

const MODULE = {
  _id: 'm1',
  title: 'Basics',
  lessons: [{ _id: 'l1', title: 'One', generationStatus: 'ready' }],
}
const SUMMARY = { courseId: 'c1', status: 'complete', readyLessons: 1, degradedLessons: 0, totalLessons: 1 }

function collector({ isCurrent = () => true } = {}) {
  const seen = { modules: [], done: [], errors: [] }
  return {
    seen,
    handlers: {
      isCurrent,
      onModule: (courseModule) => seen.modules.push(courseModule),
      onDone: (summary) => seen.done.push(summary),
      onError: (payload) => seen.errors.push(payload),
    },
  }
}

describe('consumeCourseEvents', () => {
  test('delivers modules then exactly one terminal record', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()

    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(sseRecord('module', MODULE))
    stream.push(sseRecord('done', SUMMARY))
    await consuming

    expect(seen.modules).toEqual([MODULE])
    expect(seen.done).toEqual([SUMMARY])
    expect(seen.errors).toEqual([])
  })

  test('reassembles a record split at every byte boundary', async () => {
    const text = sseRecord('module', MODULE) + sseRecord('done', SUMMARY)
    const bytes = new TextEncoder().encode(text)

    for (let split = 1; split < bytes.length; split += 1) {
      const stream = streamResponse()
      const { seen, handlers } = collector()
      const consuming = consumeCourseEvents(stream.response, handlers)
      stream.pushBytes(bytes.slice(0, split))
      stream.pushBytes(bytes.slice(split))
      await consuming
      expect(seen.modules, `split at ${split}`).toHaveLength(1)
      expect(seen.done, `split at ${split}`).toHaveLength(1)
    }
  })

  test('reassembles multibyte characters split across chunks', async () => {
    const multibyte = { ...MODULE, title: 'Módulo — básico 🎓' }
    const bytes = new TextEncoder().encode(sseRecord('module', multibyte) + sseRecord('done', SUMMARY))

    for (let split = 1; split < bytes.length; split += 1) {
      const stream = streamResponse()
      const { seen, handlers } = collector()
      const consuming = consumeCourseEvents(stream.response, handlers)
      stream.pushBytes(bytes.slice(0, split))
      stream.pushBytes(bytes.slice(split))
      await consuming
      expect(seen.modules[0].title, `split at ${split}`).toBe('Módulo — básico 🎓')
    }
  })

  test('accepts CRLF record boundaries', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(`event: module\r\ndata: ${JSON.stringify(MODULE)}\r\n\r\n`)
    stream.push(`event: done\r\ndata: ${JSON.stringify(SUMMARY)}\r\n\r\n`)
    await consuming
    expect(seen.modules).toHaveLength(1)
    expect(seen.done).toHaveLength(1)
  })

  test('preserves the order of several records delivered in one chunk', async () => {
    const second = { ...MODULE, _id: 'm2' }
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(sseRecord('module', MODULE) + sseRecord('module', second) + sseRecord('done', SUMMARY))
    await consuming
    expect(seen.modules.map((m) => m._id)).toEqual(['m1', 'm2'])
  })

  test('ignores heartbeat comments and unknown event types', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(': keepalive\n\n')
    stream.push('event: progress\ndata: {"n":1}\n\n')
    stream.push(sseRecord('done', SUMMARY))
    await consuming
    expect(seen.modules).toEqual([])
    expect(seen.done).toHaveLength(1)
  })

  test('a malformed recognised record is an invalid_response error', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push('event: module\ndata: {not json\n\n')
    await expect(consuming).rejects.toMatchObject({ code: 'invalid_response' })
    expect(seen.modules).toEqual([])
  })

  test('a module record missing lesson statuses is rejected', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(sseRecord('module', { _id: 'm1', lessons: [{ _id: 'l1' }] }))
    await expect(consuming).rejects.toMatchObject({ code: 'invalid_response' })
    expect(seen.modules).toEqual([])
  })

  test('a clean EOF with no terminal record is an interruption', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(sseRecord('module', MODULE))
    stream.close()

    await expect(consuming).rejects.toMatchObject({
      code: 'stream_interrupted',
      message: 'Generation connection closed before completion. Retry to continue.',
    })
    expect(seen.modules).toHaveLength(1)
    expect(seen.done).toEqual([])
  })

  test('an empty clean EOF is also an interruption', async () => {
    const stream = streamResponse()
    const { handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.close()
    await expect(consuming).rejects.toMatchObject({ code: 'stream_interrupted' })
  })

  test('records after a terminal record are ignored', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(sseRecord('done', SUMMARY) + sseRecord('module', MODULE))
    await consuming
    expect(seen.done).toHaveLength(1)
    expect(seen.modules).toEqual([])
  })

  test('an application error record ends the run through its callback', async () => {
    const stream = streamResponse()
    const { seen, handlers } = collector()
    const consuming = consumeCourseEvents(stream.response, handlers)
    stream.push(sseRecord('error', { code: 'generation_timeout', message: 'Timed out.', retriable: true }))
    await consuming
    expect(seen.errors).toEqual([{ code: 'generation_timeout', message: 'Timed out.', retriable: true }])
    expect(seen.done).toEqual([])
  })

  test('a superseded run stops quietly rather than reporting an error', async () => {
    const stream = streamResponse()
    let current = true
    const { seen, handlers } = collector({ isCurrent: () => current })
    const consuming = consumeCourseEvents(stream.response, handlers)

    stream.push(sseRecord('module', MODULE))
    await Promise.resolve()
    current = false
    stream.push(sseRecord('module', { ...MODULE, _id: 'm2' }))
    stream.close()

    await expect(consuming).resolves.toBeUndefined()
    expect(seen.modules.map((m) => m._id)).toEqual(['m1'])
  })

  test('a non-stream response is rejected before any parsing', async () => {
    await expect(
      consumeCourseEvents(jsonResponse({ ok: true }), collector().handlers),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })

  test('an HTTP failure is decoded with the ordinary envelope', async () => {
    const failure = jsonResponse({ error: { code: 'not_found', message: 'Course not found' } }, { status: 404 })
    await expect(
      consumeCourseEvents(failure, collector().handlers),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })
})
