import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_URL } from '../api'

export default function LessonPage() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const [lesson, setLesson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/api/lessons/${lessonId}`)
      .then(r => r.json())
      .then(data => { setLesson(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [lessonId])

  async function handleGenerate() {
    // LEARNING CHECKPOINT #3 — Progressive generation UX + frontend state.
    // Naive behaviour: flip a single boolean, block behind a spinner until the
    // ENTIRE lesson (content + video enrichment) comes back in one response,
    // then render it all at once. There is no progressive/streamed rendering,
    // no cancel, and a mid-generation error just clears the spinner.
    // See LEARNING.md (Checkpoint 3) for what to build.
    setGenerating(true)
    try {
      const res = await fetch(`${API_URL}/api/lessons/${lessonId}/generate`, {
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
      <h1 className="text-3xl font-bold mb-6">{lesson?.title}</h1>

      {lesson?.objectives?.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-5 mb-8">
          <h2 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-3">
            Learning objectives
          </h2>
          <ul className="list-disc list-inside space-y-1 text-gray-300">
            {lesson.objectives.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}

      {lesson?.content?.length > 0 ? (
        <>
          <div className="space-y-6">
            {lesson.content.map((block, i) => (
              <LessonBlock key={i} block={block} />
            ))}
          </div>
          {lesson.videos?.length > 0 && (
            <div className="mt-10">
              <h2 className="text-2xl font-semibold mb-4">Related videos</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {lesson.videos.map((v) => (
                  <a
                    key={v.videoId}
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-gray-900 rounded-xl overflow-hidden hover:ring-2 hover:ring-indigo-500 transition"
                  >
                    {v.thumbnail && <img src={v.thumbnail} alt="" className="w-full" />}
                    <div className="p-3">
                      <p className="text-sm text-gray-200 line-clamp-2">{v.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{v.channel}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
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
        {block.options?.map((opt, i) => {
          const isAnswer = i === block.answer
          const isPicked = i === selected
          let cls = 'bg-gray-800 text-gray-300'
          if (answered && isAnswer) cls = 'bg-green-800 text-green-100'
          else if (answered && isPicked) cls = 'bg-red-800 text-red-100'
          return (
            <button
              key={i}
              onClick={() => !answered && setSelected(i)}
              disabled={answered}
              className={`w-full text-left rounded-lg px-4 py-2 transition ${cls} ${answered ? '' : 'hover:bg-gray-700'}`}
            >
              {i + 1}. {opt}
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
