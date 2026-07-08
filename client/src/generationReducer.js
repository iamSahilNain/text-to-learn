// ============================================================================
// LEARNING CHECKPOINT #3 — Progressive generation UX + frontend state
// ----------------------------------------------------------------------------
// A pure state machine replacing the single `generating` boolean. Legal
// states: idle -> generating -> done, plus error. Modules arrive one at a
// time (MODULE_RECEIVED) so the UI can render partial progress instead of
// blocking on the whole course. A monotonically-increasing `token` is bumped
// on START and CANCEL so that results from a superseded/cancelled request
// (identified by the token they were dispatched with) are silently ignored
// instead of racing a stale setState onto the current view.
// See LEARNING.md (Checkpoint 3) and client/tests/progressiveGeneration.test.js.
// ============================================================================

export const initialGenerationState = {
  status: 'idle', // 'idle' | 'generating' | 'done' | 'error'
  modules: [],
  error: null,
  token: 0,
}

export function generationReducer(state, action) {
  switch (action.type) {
    case 'START':
      return {
        status: 'generating',
        modules: [],
        error: null,
        token: (state.token ?? 0) + 1,
      }

    case 'MODULE_RECEIVED': {
      // A result tagged with a token other than the current one belongs to
      // a generation that was since cancelled/superseded -- drop it.
      if (action.token !== state.token) return state
      return { ...state, modules: [...state.modules, action.module] }
    }

    case 'DONE': {
      if (action.token !== undefined && action.token !== state.token) return state
      return { ...state, status: 'done' }
    }

    case 'ERROR': {
      if (action.token !== undefined && action.token !== state.token) return state
      // Preserve whatever modules already arrived -- an error mid-generation
      // should not blow away partial progress.
      return { ...state, status: 'error', error: action.error }
    }

    case 'CANCEL':
      return { ...state, status: 'idle', token: (state.token ?? 0) + 1 }

    default:
      return state
  }
}
