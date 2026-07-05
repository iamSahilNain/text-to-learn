import { useEffect, useReducer, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_URL } from '../api'
import { generationReducer, initialGenerationState } from '../generationReducer'

// Parse one `event: ...\ndata: ...` SSE record (already split on the blank
// line that separates records) into { event, data }.
function parseSseEvent(raw) {
  let event = 'message'
  const dataLines = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  const dataStr = dataLines.join('\n')
  if (!dataStr) return { event, data: null }
  try {
    return { event, data: JSON.parse(dataStr) }
  } catch {
    return { event, data: dataStr }
  }
}

export default function CoursePage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // LEARNING CHECKPOINT #3 — Progressive generation UX + frontend state.
  // Replaces a single boolean with an explicit state machine (idle ->
  // generating -> done, or error) that appends modules as they stream in
  // over SSE instead of blocking on the whole course. `tokenRef` mirrors the
  // reducer's own token bump on START/CANCEL so events dispatched from
  // inside the async read loop below can be tagged with the generation they
  // belong to -- the reducer drops anything tagged with a stale token, so a
  // cancelled/superseded stream can never paint over the current view.
  const [genState, dispatch] = useReducer(generationReducer, initialGenerationState)
  const tokenRef = useRef(0)
  const abortRef = useRef(null)

  useEffect(() => {
    fetch(`${API_URL}/api/courses/${courseId}`)
      .then(r => r.json())
      .then(data => { setCourse(data); setLoading(false) })
      .catch(() => setLoading(false))
    // Abort any in-flight generation stream if the user navigates away.
    return () => abortRef.current?.abort()
  }, [courseId])

  async function handleGenerateFullCourse() {
    tokenRef.current += 1
    const token = tokenRef.current
    dispatch({ type: 'START' })

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_URL}/api/courses/${courseId}/generate-content`, {
        method: 'POST',
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Generation failed to start (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let sepIndex
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex)
          buffer = buffer.slice(sepIndex + 2)
          const { event, data } = parseSseEvent(rawEvent)

          if (event === 'module') {
            dispatch({ type: 'MODULE_RECEIVED', token, module: data })
            // Render this module's freshly-generated lessons immediately,
            // without waiting for the rest of the course.
            setCourse(prev => prev && {
              ...prev,
              modules: prev.modules.map(m => (m._id === data._id ? data : m)),
            })
          } else if (event === 'done') {
            dispatch({ type: 'DONE', token })
          } else if (event === 'error') {
            dispatch({ type: 'ERROR', token, error: data?.message || 'Generation failed' })
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        dispatch({ type: 'ERROR', token, error: err.message || 'Generation failed' })
      }
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
    tokenRef.current += 1
    dispatch({ type: 'CANCEL' })
  }

  // Prefer the server-side pdfkit export (streams a real download, no
  // browser rendering needed). Fall back to the lazy-loaded client-side
  // jsPDF export (src/pdf.js) if the server request fails for any reason.
  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch(`${API_URL}/api/courses/${courseId}/pdf`)
      if (!res.ok) throw new Error(`server export failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(course.title || 'course').replace(/[^\w]+/g, '-').toLowerCase()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Server PDF export failed, falling back to client-side export:', err)
      const { exportCourseToPdf } = await import('../pdf')
      exportCourseToPdf(course)
    } finally {
      setExporting(false)
    }
  }

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

  const generating = genState.status === 'generating'
  const generatedIds = new Set(genState.modules.map(m => m._id))

  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-10 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/')}
          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-2"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          {generating ? (
            <button
              onClick={handleCancel}
              className="bg-red-900 hover:bg-red-800 text-red-100 text-sm font-medium rounded-lg px-4 py-2 transition"
            >
              Cancel generation
            </button>
          ) : (
            <button
              onClick={handleGenerateFullCourse}
              className="bg-indigo-700 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
            >
              Generate full course
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-lg px-4 py-2 transition"
          >
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {genState.status !== 'idle' && (
        <div className="bg-gray-900 rounded-xl p-4 mb-8 text-sm">
          {generating && (
            <p className="text-indigo-300">
              Generating module {genState.modules.length + 1} of {course.modules?.length ?? '?'}…
            </p>
          )}
          {genState.status === 'done' && (
            <p className="text-green-400">All {genState.modules.length} module(s) generated.</p>
          )}
          {genState.status === 'error' && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-red-400">
                Generation stopped: {genState.error}. {genState.modules.length} module(s) were saved before the failure.
              </p>
              <button
                onClick={handleGenerateFullCourse}
                className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium rounded-lg px-3 py-1.5 transition whitespace-nowrap"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

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
            <h2 className="text-xl font-semibold mb-4 text-indigo-300 flex items-center gap-2">
              Module {mi + 1}: {mod.title}
              {generatedIds.has(mod._id) && (
                <span className="text-xs bg-green-900 text-green-300 rounded-full px-2 py-0.5">generated</span>
              )}
            </h2>
            <div className="space-y-2">
              {mod.lessons?.map((lesson, li) => (
                <button
                  key={lesson._id}
                  onClick={() => navigate(`/lesson/${lesson._id}`)}
                  className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3 text-gray-200 transition flex items-center justify-between"
                >
                  <span>{li + 1}. {lesson.title}</span>
                  {lesson.content?.length > 0 && <span className="text-green-400 text-xs">✓ generated</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
