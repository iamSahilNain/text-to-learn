import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson } from '../api'

export default function Home() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  // The disabled attribute only takes effect after React commits the next
  // render, so a burst of Enter presses needs a synchronous guard too.
  const busyRef = useRef(false)
  const controllerRef = useRef(null)
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      controllerRef.current?.abort()
      controllerRef.current = null
      busyRef.current = false
    }
  }, [])

  async function handleGenerate(event) {
    event.preventDefault()

    const trimmed = topic.trim()
    if (busyRef.current || !trimmed) return
    busyRef.current = true

    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError('')

    try {
      const course = await fetchJson('/api/courses/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: trimmed }),
        signal: controller.signal,
      })
      if (!activeRef.current || controller.signal.aborted) return
      if (typeof course?._id !== 'string' || course._id.length === 0) {
        throw new Error('The server sent an unexpected course.')
      }
      navigate(`/course/${course._id}`)
    } catch (err) {
      if (err?.name === 'AbortError' || !activeRef.current) return
      setError(err?.message || 'Failed to generate course. Try again.')
    } finally {
      // Only the request that is still current may release the controls.
      if (controllerRef.current === controller) {
        controllerRef.current = null
        busyRef.current = false
        setLoading(false)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <h1 className="text-5xl font-bold mb-4 text-center">Text to Learn</h1>
      <p className="text-gray-400 mb-10 text-center text-lg">
        Enter any topic and get a complete course instantly
      </p>
      <form className="w-full max-w-xl" onSubmit={handleGenerate}>
        <label htmlFor="topic" className="sr-only">Topic</label>
        <input
          id="topic"
          type="text"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={loading}
          placeholder="e.g. Introduction to React Hooks"
          className="w-full bg-gray-800 text-white rounded-xl px-5 py-4 text-lg outline-none focus:ring-2 focus:ring-indigo-500 mb-4 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 text-white font-semibold rounded-xl py-4 text-lg transition"
        >
          {loading ? 'Generating your course...' : 'Generate Course'}
        </button>
        {error && <p role="alert" className="text-red-400 mt-4 text-center">{error}</p>}
      </form>
      <button
        onClick={() => navigate('/courses')}
        className="text-indigo-400 hover:text-indigo-300 mt-10 text-sm"
      >
        View my courses →
      </button>
    </div>
  )
}
