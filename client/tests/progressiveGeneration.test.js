// The combined reducer owns both the displayed course and the generation
// state, so a streamed update and the progress it implies land in one
// transition and a stale run can never write to the course.

import { describe, expect, test } from 'vitest'
import { generationReducer, initialGenerationState } from '../src/generationReducer'

const MODULE_ONE = { _id: 'm1', title: 'Basics', lessons: [{ _id: 'l1', generationStatus: 'pending' }] }
const MODULE_TWO = { _id: 'm2', title: 'Advanced', lessons: [{ _id: 'l2', generationStatus: 'pending' }] }
const COURSE = { _id: 'c1', title: 'Rust', outlineStatus: 'ready', modules: [MODULE_ONE, MODULE_TWO] }

const READY_ONE = { ...MODULE_ONE, lessons: [{ _id: 'l1', generationStatus: 'ready' }] }
const SUMMARY = { courseId: 'c1', status: 'complete', readyLessons: 2, degradedLessons: 0, totalLessons: 2 }

function loaded() {
  return generationReducer(initialGenerationState, { type: 'LOAD_SUCCESS', course: COURSE })
}

function generating(state = loaded(), token = state.generation.token + 1) {
  return generationReducer(state, { type: 'START', token })
}

describe('loading', () => {
  test('a successful load stores the course and clears any error', () => {
    const state = generationReducer(
      { ...initialGenerationState, loadStatus: 'error', loadError: 'boom' },
      { type: 'LOAD_SUCCESS', course: COURSE },
    )
    expect(state.loadStatus).toBe('ready')
    expect(state.loadError).toBeNull()
    expect(state.course).toBe(COURSE)
  })

  test('a 404 is distinct from other failures, and neither becomes the course', () => {
    const missing = generationReducer(initialGenerationState, { type: 'LOAD_FAILURE', status: 404, error: 'Course not found' })
    expect(missing.loadStatus).toBe('not-found')
    expect(missing.course).toBeNull()

    const failed = generationReducer(initialGenerationState, { type: 'LOAD_FAILURE', status: 500, error: 'Something went wrong' })
    expect(failed.loadStatus).toBe('error')
    expect(failed.loadError).toBe('Something went wrong')
    expect(failed.course).toBeNull()
  })
})

describe('generation lifecycle', () => {
  test('START keeps the loaded course and clears the previous run', () => {
    const state = generating(
      generationReducer(generating(), { type: 'ERROR', token: 1, error: { code: 'x', message: 'y', retriable: true } }),
    )
    expect(state.course).toBe(COURSE)
    expect(state.generation.status).toBe('generating')
    expect(state.generation.error).toBeNull()
    expect(state.generation.receivedModuleIds).toEqual([])
  })

  test('a stale START is ignored', () => {
    const state = generating()
    expect(generationReducer(state, { type: 'START', token: state.generation.token })).toBe(state)
    expect(generationReducer(state, { type: 'START', token: state.generation.token - 1 })).toBe(state)
  })

  test('a module replaces its course entry immutably and counts once', () => {
    const started = generating()
    const state = generationReducer(started, { type: 'MODULE_RECEIVED', token: started.generation.token, module: READY_ONE })

    expect(state.course.modules[0]).toEqual(READY_ONE)
    expect(state.course.modules[1]).toBe(MODULE_TWO)
    expect(state.course.modules).not.toBe(COURSE.modules)
    expect(COURSE.modules[0]).toBe(MODULE_ONE)
    expect(state.generation.receivedModuleIds).toEqual(['m1'])

    // A resent module updates content without inflating progress.
    const again = generationReducer(state, {
      type: 'MODULE_RECEIVED',
      token: started.generation.token,
      module: { ...READY_ONE, title: 'Basics revised' },
    })
    expect(again.course.modules[0].title).toBe('Basics revised')
    expect(again.generation.receivedModuleIds).toEqual(['m1'])
  })

  test('a module for an unknown id is dropped', () => {
    const started = generating()
    const state = generationReducer(started, {
      type: 'MODULE_RECEIVED',
      token: started.generation.token,
      module: { _id: 'unknown', lessons: [] },
    })
    expect(state).toBe(started)
  })

  test('DONE takes its status from the summary and keeps the course', () => {
    const started = generating()
    const withModule = generationReducer(started, { type: 'MODULE_RECEIVED', token: started.generation.token, module: READY_ONE })
    const done = generationReducer(withModule, { type: 'DONE', token: started.generation.token, summary: SUMMARY })

    expect(done.generation.status).toBe('complete')
    expect(done.generation.summary).toBe(SUMMARY)
    expect(done.course.modules[0]).toEqual(READY_ONE)
    expect(done.generation.receivedModuleIds).toEqual(['m1'])

    const degradedSummary = { ...SUMMARY, status: 'degraded', readyLessons: 1, degradedLessons: 1 }
    const degraded = generationReducer(withModule, { type: 'DONE', token: started.generation.token, summary: degradedSummary })
    expect(degraded.generation.status).toBe('degraded')
  })

  test('an error keeps the modules that really arrived', () => {
    const started = generating()
    const withModule = generationReducer(started, { type: 'MODULE_RECEIVED', token: started.generation.token, module: READY_ONE })
    const error = { code: 'stream_interrupted', message: 'Connection closed.', retriable: true }
    const state = generationReducer(withModule, { type: 'ERROR', token: started.generation.token, error })

    expect(state.generation.status).toBe('error')
    expect(state.generation.error).toBe(error)
    expect(state.course.modules[0]).toEqual(READY_ONE)
    expect(state.generation.receivedModuleIds).toEqual(['m1'])
  })
})

describe('token discipline', () => {
  test('events from a superseded run cannot touch the course', () => {
    const started = generating()
    const staleToken = started.generation.token
    const cancelled = generationReducer(started, { type: 'CANCEL', token: staleToken + 1 })

    expect(cancelled.generation.status).toBe('idle')
    expect(cancelled.course).toBe(COURSE)

    for (const action of [
      { type: 'MODULE_RECEIVED', token: staleToken, module: READY_ONE },
      { type: 'DONE', token: staleToken, summary: SUMMARY },
      { type: 'ERROR', token: staleToken, error: { code: 'x', message: 'y', retriable: true } },
    ]) {
      expect(generationReducer(cancelled, action), action.type).toBe(cancelled)
    }
  })

  test('a stale CANCEL cannot reset a newer run', () => {
    const first = generating()
    const second = generating(first)
    expect(generationReducer(second, { type: 'CANCEL', token: first.generation.token })).toBe(second)
  })

  test('events without a token are ignored', () => {
    const started = generating()
    for (const action of [
      { type: 'MODULE_RECEIVED', module: READY_ONE },
      { type: 'DONE', summary: SUMMARY },
      { type: 'ERROR', error: { code: 'x', message: 'y', retriable: true } },
    ]) {
      expect(generationReducer(started, action), action.type).toBe(started)
    }
  })

  test('events after a terminal state are ignored even with a matching token', () => {
    const started = generating()
    const token = started.generation.token
    const done = generationReducer(started, { type: 'DONE', token, summary: SUMMARY })

    expect(generationReducer(done, { type: 'MODULE_RECEIVED', token, module: READY_ONE })).toBe(done)
    expect(generationReducer(done, { type: 'DONE', token, summary: SUMMARY })).toBe(done)
    expect(generationReducer(done, { type: 'ERROR', token, error: { code: 'x', message: 'y', retriable: true } })).toBe(done)
  })
})
