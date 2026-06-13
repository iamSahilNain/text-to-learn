// Single source of truth for the backend base URL.
// Override in client/.env with VITE_API_URL; falls back to localhost for dev.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
