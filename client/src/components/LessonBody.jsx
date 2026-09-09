import InlineText from './InlineText'
import LessonBlock from './LessonBlock'

// Shared between the private LessonPage and the read-only demo lesson view.
// readOnly omits every generate/retry control -- the demo never calls
// /api/lessons/:id/generate, so this is enforced here rather than trusted to
// the caller alone.
export default function LessonBody({ lesson, readOnly = false, generating = false, onGenerate }) {
  const status = lesson.generationStatus

  return (
    <>
      {!readOnly && status === 'degraded' && (
        <div className="mb-8 flex items-center justify-between gap-4 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm text-warning">Fallback content — generation could not complete.</p>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="whitespace-nowrap rounded-lg bg-warning/20 px-4 py-2 text-sm font-medium text-warning transition hover:bg-warning/30 disabled:opacity-50"
          >
            {generating ? 'Generating content...' : 'Retry generation'}
          </button>
        </div>
      )}

      {lesson.objectives?.length > 0 && (
        <div className="mb-8 rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent">Learning objectives</h2>
          <ul className="list-inside list-disc space-y-1 text-text-muted">
            {lesson.objectives.map((objective, index) => (
              <li key={index}>
                <InlineText text={objective} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {status === 'pending' ? (
        <div className="py-20 text-center">
          <p className="mb-6 text-text-muted">No content yet for this lesson.</p>
          {!readOnly && (
            <button
              onClick={onGenerate}
              disabled={generating}
              className="rounded-xl bg-action px-8 py-4 font-semibold text-white transition hover:bg-action-hover disabled:opacity-60"
            >
              {generating ? 'Generating content...' : 'Generate Lesson Content'}
            </button>
          )}
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
              <h2 className="mb-4 text-2xl font-semibold text-text">Related videos</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {lesson.videos.map((video) => (
                  <a
                    key={video.videoId}
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-xl border border-border bg-surface transition hover:ring-2 hover:ring-accent"
                  >
                    {video.thumbnail && <img src={video.thumbnail} alt="" className="w-full" />}
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm text-text">{video.title}</p>
                      <p className="mt-1 text-xs text-text-muted">{video.channel}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
