import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchJson, invalidResponse, isValidLesson } from '../api'

export default function LessonPage() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const [lesson, setLesson] = useState(null)
  const [loadStatus, setLoadStatus] = useState('loading') // loading | ready | not-found | error
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')

  // The generate request has its own lifecycle: the loaded lesson must
  // survive a failed regeneration untouched.
  const requestTokenRef = useRef(0)
  const requestControllerRef = useRef(null)
  const busyRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchJson(`/api/lessons/${lessonId}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return
        if (!isValidLesson(data)) throw invalidResponse('lesson')
        setLesson(data)
        setLoadStatus('ready')
      })
      .catch((err) => {
        if (!active || err?.name === 'AbortError') return
        setLoadStatus(err?.status === 404 ? 'not-found' : 'error')
        setLoadError(err?.message || 'Failed to load lesson.')
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [lessonId, loadAttempt])

  useEffect(() => () => {
    requestTokenRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  function retryLoad() {
    setLoadStatus('loading')
    setLoadError('')
    setLoadAttempt((attempt) => attempt + 1)
  }

  async function handleGenerate() {
    if (busyRef.current) return
    busyRef.current = true

    requestTokenRef.current += 1
    const token = requestTokenRef.current
    const controller = new AbortController()
    requestControllerRef.current = controller

    setGenerating(true)
    setGenerationError('')

    try {
      const data = await fetchJson(`/api/lessons/${lessonId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
        signal: controller.signal,
      })
      if (requestTokenRef.current !== token || controller.signal.aborted) return
      if (!isValidLesson(data) || data._id !== lessonId) throw invalidResponse('lesson')
      // Only a complete, valid lesson replaces what is on screen.
      setLesson(data)
    } catch (err) {
      if (err?.name === 'AbortError' || requestTokenRef.current !== token) return
      setGenerationError(err?.message || 'Generation failed.')
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
        busyRef.current = false
        setGenerating(false)
      }
    }
  }

  if (loadStatus === 'loading') return (
    <Centered><p className="text-gray-400 text-xl">Loading lesson...</p></Centered>
  )

  if (loadStatus === 'not-found') return (
    <Centered><p className="text-red-400 text-xl">Lesson not found</p></Centered>
  )

  if (loadStatus === 'error') return (
    <Centered>
      <div className="text-center">
        <p role="alert" className="text-red-400 text-xl mb-6">{loadError}</p>
        <button
          onClick={retryLoad}
          className="bg-indigo-700 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
        >
          Retry
        </button>
      </div>
    </Centered>
  )

  const status = lesson.generationStatus

  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-10 max-w-3xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="text-indigo-400 hover:text-indigo-300 mb-8"
      >
        ← Back to course
      </button>
      <h1 className="text-3xl font-bold mb-6">{lesson.title}</h1>

      {generationError && <p role="alert" className="text-red-400 mb-6">{generationError}</p>}

      {status === 'degraded' && (
        <div className="bg-amber-950 border border-amber-900 rounded-xl p-4 mb-8 flex items-center justify-between gap-4">
          <p className="text-amber-200 text-sm">Fallback content — generation could not complete.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-amber-800 hover:bg-amber-700 disabled:opacity-50 text-amber-50 text-sm font-medium rounded-lg px-4 py-2 transition whitespace-nowrap"
          >
            {generating ? 'Generating content...' : 'Retry generation'}
          </button>
        </div>
      )}

      {lesson.objectives?.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-5 mb-8">
          <h2 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-3">
            Learning objectives
          </h2>
          <ul className="list-disc list-inside space-y-1 text-gray-300">
            {lesson.objectives.map((objective, index) => <li key={index}>{objective}</li>)}
          </ul>
        </div>
      )}

      {status === 'pending' ? (
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
      ) : (
        <>
          <div className="space-y-6">
            {lesson.content.map((block, index) => (
              <LessonBlock key={index} block={block} />
            ))}
          </div>
          {lesson.videos?.length > 0 && (
            <div className="mt-10">
              <h2 className="text-2xl font-semibold mb-4">Related videos</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {lesson.videos.map((video) => (
                  <a
                    key={video.videoId}
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-gray-900 rounded-xl overflow-hidden hover:ring-2 hover:ring-indigo-500 transition"
                  >
                    {video.thumbnail && <img src={video.thumbnail} alt="" className="w-full" />}
                    <div className="p-3">
                      <p className="text-sm text-gray-200 line-clamp-2">{video.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{video.channel}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Centered({ children }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      {children}
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
      return <McqBlock block={block} />
    default:
      return null
  }
}

function McqBlock({ block }) {
  const [selected, setSelected] = useState(null)
  const answered = selected !== null

  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <p className="font-semibold mb-3">{block.question}</p>
      <div className="space-y-2">
        {block.options?.map((option, index) => {
          const isAnswer = index === block.answer
          const isPicked = index === selected
          let className = 'bg-gray-800 text-gray-300'
          if (answered && isAnswer) className = 'bg-green-800 text-green-100'
          else if (answered && isPicked) className = 'bg-red-800 text-red-100'
          return (
            <button
              key={index}
              onClick={() => !answered && setSelected(index)}
              disabled={answered}
              className={`w-full text-left rounded-lg px-4 py-2 transition ${className} ${answered ? '' : 'hover:bg-gray-700'}`}
            >
              {index + 1}. {option}
            </button>
          )
        })}
      </div>
      {answered && (
        <div className="mt-4 text-sm">
          <p className={selected === block.answer ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
            {selected === block.answer ? 'Correct!' : 'Not quite.'}
          </p>
          {block.explanation && <p className="text-gray-400 mt-1">{block.explanation}</p>}
        </div>
      )}
    </div>
  )
}
