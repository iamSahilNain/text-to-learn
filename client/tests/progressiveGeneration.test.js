// ============================================================================
// LEARNING CHECKPOINT #3 — Progressive generation UX + frontend state
// ----------------------------------------------------------------------------
// SKIPPED specs describing the hardened behaviour to build for lesson/course
// generation in the client. Today LessonPage flips a single `generating`
// boolean and blocks on a spinner until the whole response returns.
//
// These specs target a pure state-machine reducer (suggested name
// `generationReducer`) that you would extract so the UI can render modules as
// they stream/poll in, support cancel, and survive mid-generation errors.
// Run with: npm test (uses node --test). Remove `{ skip }` to activate.
// See LEARNING.md → Checkpoint 3 for hints and reading.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert'

const SKIP = { skip: 'LEARNING CHECKPOINT #3 — implement progressive generation state' }

test('reducer starts generating from idle', SKIP, () => {
  // const s = generationReducer({ status: 'idle', modules: [] }, { type: 'START' })
  // assert.equal(s.status, 'generating')
  assert.fail('not implemented')
})

test('reducer appends modules progressively as they arrive', SKIP, () => {
  // Each MODULE_RECEIVED action should append to modules WITHOUT waiting for
  // the whole course, so the UI can render partial progress.
  assert.fail('not implemented')
})

test('cancel returns to idle and ignores results that arrive afterwards', SKIP, () => {
  // After CANCEL, a late MODULE_RECEIVED must NOT mutate state (no race where a
  // cancelled request still paints modules).
  assert.fail('not implemented')
})

test('a mid-generation error keeps already-received modules and sets error', SKIP, () => {
  // An ERROR action must preserve the modules received so far and expose an
  // error the UI can show + offer retry — not blow everything away.
  assert.fail('not implemented')
})
