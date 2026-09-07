import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TextDecoder, TextEncoder } from 'node:util'
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web'

// jsdom ships neither the streaming text codecs nor the WHATWG stream types
// the SSE consumer relies on. Use Node's real implementations so the stream
// tests exercise the same chunk/boundary behaviour as a browser.
for (const [name, value] of Object.entries({
  TextDecoder,
  TextEncoder,
  ReadableStream,
  TransformStream,
  WritableStream,
})) {
  if (!(name in globalThis)) globalThis[name] = value
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
