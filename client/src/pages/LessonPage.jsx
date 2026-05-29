import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function LessonPage() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const [lesson, setLesson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetch(`http://localhost:3001/api/lessons/${lessonId}`)
      .then(r => r.json())
      .then(data => { setLesson(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [lessonId])

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch(`http://localhost:3001/api/lessons/${lessonId}/generate`, {
        method: 'POST'
      })
      const data = await res.json()
      setLesson(data)
    } catch (err) {
      console.error(err)
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <p className="text-gray-400 text-xl">Loading lesson...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-10 max-w-3xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="text-indigo-400 hover:text-indigo-300 mb-8"
      >
        ← Back to course
      </button>
      <h1 className="text-3xl font-bold mb-8">{lesson?.title}</h1>
      {lesson?.content?.length > 0 ? (
        <div className="space-y-6">
          {lesson.content.map((block, i) => (
            <LessonBlock key={i} block={block} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-gray-400 mb-6">No content yet for this lesson.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 text-white font-semibold rounded-xl px-8 py-4 transition"
          >
            {generating ? 'Generating content...' : 'Generate Lesson Content'}
          </button>
        </div>
      )}
    </div>
  )
}

function LessonBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return <h2 className="text-2xl font-semibold text-white">{block.text}</h2>
    case 'paragraph':
      return <p className="text-gray-300 leading-relaxed">{block.text}</p>
    case 'code':
      return (
        <pre className="bg-gray-900 rounded-xl p-4 overflow-x-auto text-green-300 text-sm">
          <code>{block.text}</code>
        </pre>
      )
    case 'mcq':
      return (
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="font-semibold mb-3">{block.question}</p>
          <div className="space-y-2">
            {block.options?.map((opt, i) => (
              <div key={i} className="bg-gray-800 rounded-lg px-4 py-2 text-gray-300">
                {i + 1}. {opt}
              </div>
            ))}
          </div>
        </div>
      )
    default:
      return null
  }
}