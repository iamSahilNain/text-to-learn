// ============================================================================
// LEARNING CHECKPOINT #3 — Progressive generation UX + frontend state
// ----------------------------------------------------------------------------
// Activated: client/src/generationReducer.js replaces the single `generating`
// boolean in LessonPage/CoursePage with a token-guarded state machine. Run
// with: npm test (uses node --test).
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert'

import { generationReducer, initialGenerationState } from '../src/generationReducer.js'

test('reducer starts generating from idle', () => {
  const s = generationReducer({ status: 'idle', modules: [] }, { type: 'START' })
  assert.equal(s.status, 'generating')
})

test('reducer appends modules progressively as they arrive', () => {
  // Each MODULE_RECEIVED action should append to modules WITHOUT waiting for
  // the whole course, so the UI can render partial progress.
  let state = generationReducer(initialGenerationState, { type: 'START' })

  state = generationReducer(state, {
    type: 'MODULE_RECEIVED',
    token: state.token,
    module: { title: 'Module 1' },
  })
  assert.equal(state.modules.length, 1)
  assert.equal(state.status, 'generating')

  state = generationReducer(state, {
    type: 'MODULE_RECEIVED',
    token: state.token,
    module: { title: 'Module 2' },
  })
  assert.equal(state.modules.length, 2)
  assert.deepEqual(state.modules.map(m => m.title), ['Module 1', 'Module 2'])
})

test('cancel returns to idle and ignores results that arrive afterwards', () => {
  // After CANCEL, a late MODULE_RECEIVED must NOT mutate state (no race where
  // a cancelled request still paints modules).
  let state = generationReducer(initialGenerationState, { type: 'START' })
  const staleToken = state.token

  state = generationReducer(state, { type: 'CANCEL' })
  assert.equal(state.status, 'idle')

  const after = generationReducer(state, {
    type: 'MODULE_RECEIVED',
    token: staleToken, // carries the token from before the cancel
    module: { title: 'Late module' },
  })
  assert.equal(after.modules.length, 0)
  assert.equal(after.status, 'idle')
  assert.deepEqual(after, state)
})

test('a mid-generation error keeps already-received modules and sets error', () => {
  // An ERROR action must preserve the modules received so far and expose an
  // error the UI can show + offer retry — not blow everything away.
  let state = generationReducer(initialGenerationState, { type: 'START' })
  state = generationReducer(state, {
    type: 'MODULE_RECEIVED',
    token: state.token,
    module: { title: 'Module 1' },
  })

  state = generationReducer(state, { type: 'ERROR', token: state.token, error: 'network error' })

  assert.equal(state.status, 'error')
  assert.equal(state.modules.length, 1)
  assert.equal(state.error, 'network error')
})
