// Content-generation progress only -- explicitly not a learning-progress
// claim. Ready and degraded are reported as separate truthful facts rather
// than folded into one percentage, and a course with no lessons never
// divides by zero.
export default function CourseProgress({ modules }) {
  const lessons = modules.flatMap((courseModule) => courseModule.lessons)
  const total = lessons.length
  const ready = lessons.filter((lesson) => lesson.generationStatus === 'ready').length
  const degraded = lessons.filter((lesson) => lesson.generationStatus === 'degraded').length

  return (
    <div className="mb-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span id="course-progress-label" className="font-medium text-text-muted">
          Content generated
        </span>
        <span className="text-text-muted">
          {total === 0 ? 'No lessons yet' : `${ready} of ${total} lessons ready`}
          {degraded > 0 && ` · ${degraded} need${degraded === 1 ? 's' : ''} retry`}
        </span>
      </div>
      <progress
        aria-labelledby="course-progress-label"
        className="h-2 w-full overflow-hidden rounded-full bg-surface-raised [&::-moz-progress-bar]:bg-action [&::-webkit-progress-bar]:bg-surface-raised [&::-webkit-progress-value]:bg-action"
        value={ready}
        max={total || 1}
      />
    </div>
  )
}
