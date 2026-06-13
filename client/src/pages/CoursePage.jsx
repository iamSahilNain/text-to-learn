import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_URL } from '../api'

export default function CoursePage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Lazy-load the PDF module (jsPDF is heavy) only when the user exports.
  async function handleExport() {
    setExporting(true)
    try {
      const { exportCourseToPdf } = await import('../pdf')
      exportCourseToPdf(course)
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    fetch(`${API_URL}/api/courses/${courseId}`)
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
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/')}
          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2"
        >
          ← Back
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          {exporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>
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