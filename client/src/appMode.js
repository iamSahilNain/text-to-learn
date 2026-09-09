// Public and no secrets: this only decides which routes and copy a build
// mounts, never an authorization boundary. Access control lives entirely on
// the server (see server/middleware/accessControl.js).
const VALID_MODES = ['demo', 'private']

function resolveMode(raw) {
  if (raw === undefined || raw === '') return 'private'
  if (!VALID_MODES.includes(raw)) {
    throw new Error(`Invalid VITE_APP_MODE "${raw}". Set it to "demo" or "private".`)
  }
  return raw
}

export const APP_MODE = resolveMode(import.meta.env.VITE_APP_MODE)
export const isDemoMode = APP_MODE === 'demo'
