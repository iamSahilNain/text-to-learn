import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_URL } from '../api'

// Uses the existing GET /api/courses list endpoint, which previously had no
// UI consumer at all.
export default function CoursesList() {
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/courses`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error.message || 'Failed to load courses')
        setCourses(data)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load courses.'); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-10 max-w-3xl mx-auto">
      <button
        onClick={() => navigate('/')}
        className="text-indigo-400 hover:text-indigo-300 mb-8"
      >
        ← New course
      </button>
      <h1 className="text-3xl font-bold mb-8">My Courses</h1>

      {loading && <p className="text-gray-400">Loading courses...</p>}
      {error && <p className="text-red-400">{error}</p>}
      {!loading && !error && courses.length === 0 && (
        <p className="text-gray-400">No courses yet — generate one from the home page.</p>
      )}

      <div className="space-y-3">
        {courses.map(course => (
          <button
            key={course._id}
            onClick={() => navigate(`/course/${course._id}`)}
            className="w-full text-left bg-gray-900 hover:bg-gray-800 rounded-xl px-5 py-4 transition"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-100">{course.title}</p>
                {course.description && (
                  <p className="text-sm text-gray-400 mt-1 line-clamp-1">{course.description}</p>
                )}
              </div>
              <p className="text-xs text-gray-500 whitespace-nowrap">
                {new Date(course.createdAt).toLocaleDateString()}
              </p>
            </div>
            {course.tags?.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {course.tags.map(tag => (
                  <span key={tag} className="bg-indigo-900 text-indigo-200 px-2 py-0.5 rounded-full text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
