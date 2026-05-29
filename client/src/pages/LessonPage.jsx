import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function LessonPage() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const [lesson, setLesson] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`http://localhost:3001/api/lessons/${lessonId}`)
      .then(r => r.json())
      .then(data => { setLesson(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [lessonId])

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
      <div className="space-y-6">
        {lesson?.content?.length > 0
          ? lesson.content.map((block, i) => (
              <LessonBlock key={i} block={block} />
            ))
          : <p className="text-gray-400">Content coming soon.</p>
        }
      </div>
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