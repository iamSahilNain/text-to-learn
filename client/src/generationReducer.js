// Sole owner of the course object shown by CoursePage and of its generation
// state. Keeping them in one reducer is the point: a streamed module update
// and the progress count it implies have to land in one transition, and a
// stale stream can never write to the course behind the token check.
//
// Every generation action carries the token of the run that produced it.
// CoursePage's monotonic ref is the only allocator; the reducer never
// invents one.

export const initialGenerationState = {
  course: null,
  loadStatus: 'loading', // loading | ready | not-found | error
  loadError: null,
  generation: {
    status: 'idle', // idle | generating | complete | degraded | error
    token: 0,
    receivedModuleIds: [],
    error: null,
    summary: null,
  },
}

function isCurrentRun(state, action) {
  return action.token === state.generation.token && state.generation.status === 'generating'
}

export function generationReducer(state, action) {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loadStatus: 'loading', loadError: null }

    case 'LOAD_SUCCESS':
      return { ...state, course: action.course, loadStatus: 'ready', loadError: null }

    case 'LOAD_FAILURE':
      // An error envelope is never stored as if it were a course.
      return {
        ...state,
        loadStatus: action.status === 404 ? 'not-found' : 'error',
        loadError: action.error,
      }

    case 'START': {
      if (action.token <= state.generation.token) return state
      return {
        ...state,
        generation: {
          status: 'generating',
          token: action.token,
          receivedModuleIds: [],
          error: null,
          summary: null,
        },
      }
    }

    case 'MODULE_RECEIVED': {
      if (!isCurrentRun(state, action)) return state
      const { course } = state
      if (!course) return state
      const index = course.modules.findIndex((entry) => entry._id === action.module._id)
      // The stream consumer rejects a module that is not part of the loaded
      // course before dispatching, so this cannot append an unknown id.
      if (index === -1) return state

      const modules = course.modules.slice()
      modules[index] = action.module

      const { receivedModuleIds } = state.generation
      const seen = receivedModuleIds.includes(action.module._id)

      return {
        ...state,
        course: { ...course, modules },
        generation: {
          ...state.generation,
          receivedModuleIds: seen ? receivedModuleIds : [...receivedModuleIds, action.module._id],
        },
      }
    }

    case 'DONE': {
      if (!isCurrentRun(state, action)) return state
      return {
        ...state,
        generation: { ...state.generation, status: action.summary.status, summary: action.summary },
      }
    }

    case 'ERROR': {
      if (!isCurrentRun(state, action)) return state
      // Modules that already arrived stay on screen: a failure part-way
      // through must not erase the progress that was really saved.
      return { ...state, generation: { ...state.generation, status: 'error', error: action.error } }
    }

    case 'CANCEL': {
      if (action.token <= state.generation.token) return state
      return {
        ...state,
        generation: {
          status: 'idle',
          token: action.token,
          receivedModuleIds: [],
          error: null,
          summary: null,
        },
      }
    }

    default:
      return state
  }
}
