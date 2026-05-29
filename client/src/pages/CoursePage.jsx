import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function CoursePage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`http://localhost:3001/api/courses/${courseId}`)
      .then(r => r.json())
      .then(data => { setCourse(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [courseId])

  if (loading) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <p className="text-gray-400 text-xl">Loading course...</p>
    </div>
  )

  if (!course) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <p className="text-red-400 text-xl">Course not found</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-10 max-w-4xl mx-auto">
      <button
        onClick={() => navigate('/')}
        className="text-indigo-400 hover:text-indigo-300 mb-8 flex items-center gap-2"
      >
        ← Back
      </button>
      <h1 className="text-4xl font-bold mb-3">{course.title}</h1>
      <p className="text-gray-400 mb-4">{course.description}</p>
      <div className="flex gap-2 mb-10 flex-wrap">
        {course.tags?.map(tag => (
          <span key={tag} className="bg-indigo-900 text-indigo-200 px-3 py-1 rounded-full text-sm">
            {tag}
          </span>
        ))}
      </div>
      <div className="space-y-6">
        {course.modules?.map((mod, mi) => (
          <div key={mod._id} className="bg-gray-900 rounded-2xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-indigo-300">
              Module {mi + 1}: {mod.title}
            </h2>
            <div className="space-y-2">
              {mod.lessons?.map((lesson, li) => (
                <button
                  key={lesson._id}
                  onClick={() => navigate(`/lesson/${lesson._id}`)}
                  className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3 text-gray-200 transition"
                >
                  {li + 1}. {lesson.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}