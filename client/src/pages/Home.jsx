import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_URL } from '../api'

export default function Home() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleGenerate() {
    if (!topic.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/courses/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message || 'Generation failed')
      navigate(`/course/${data._id}`)
    } catch {
      setError('Failed to generate course. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <h1 className="text-5xl font-bold mb-4 text-center">Text to Learn</h1>
      <p className="text-gray-400 mb-10 text-center text-lg">
        Enter any topic and get a complete course instantly
      </p>
      <div className="w-full max-w-xl">
        <input
          type="text"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGenerate()}
          placeholder="e.g. Introduction to React Hooks"
          className="w-full bg-gray-800 text-white rounded-xl px-5 py-4 text-lg outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
        />
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 text-white font-semibold rounded-xl py-4 text-lg transition"
        >
          {loading ? 'Generating your course...' : 'Generate Course'}
        </button>
        {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
      </div>
      <button
        onClick={() => navigate('/courses')}
        className="text-indigo-400 hover:text-indigo-300 mt-10 text-sm"
      >
        View my courses →
      </button>
    </div>
  )
}