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
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-md border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm text-warning">Fallback content — generation could not complete.</p>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="whitespace-nowrap rounded-md border border-warning px-4 py-2 text-sm font-medium text-warning transition hover:bg-warning/15 disabled:opacity-50"
          >
            {generating ? 'Generating content...' : 'Retry generation'}
          </button>
        </div>
      )}

      {lesson.objectives?.length > 0 && (
        <div className="mb-10 border-y border-border py-5">
          <h2 className="font-sans text-sm font-medium text-accent">Learning objectives</h2>
          <ul className="mt-3 space-y-1.5 font-serif text-[1.0625rem] text-text">
            {lesson.objectives.map((objective, index) => (
              <li key={index} className="flex gap-3">
                <span aria-hidden="true" className="text-text-muted">
                  —
                </span>
                <span>
                  <InlineText text={objective} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status === 'pending' ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-text-muted">No content yet for this lesson.</p>
          {!readOnly && (
            <button
              onClick={onGenerate}
              disabled={generating}
              className="mt-6 rounded-md bg-action px-6 py-3 font-medium text-white transition hover:bg-action-hover disabled:opacity-60"
            >
              {generating ? 'Generating content...' : 'Generate Lesson Content'}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-5">
            {lesson.content.map((block, index) => (
              <LessonBlock key={index} block={block} />
            ))}
          </div>
          {lesson.videos?.length > 0 && (
            <div className="mt-12 border-t border-border pt-8">
              <h2 className="text-2xl text-text">Related videos</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {lesson.videos.map((video) => (
                  <a
                    key={video.videoId}
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-md border border-border bg-surface transition hover:border-text/50"
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
