import { useNavigate } from 'react-router-dom'

const LESSON_BADGE = {
  pending: { text: 'Not generated', className: 'text-text-muted' },
  ready: { text: 'Ready', className: 'text-success' },
  degraded: { text: 'Fallback — retry available', className: 'text-warning' },
}

// A module has no stored status. It is whatever its lessons say it is, and
// an empty module is not a finished one.
function moduleStatus(courseModule) {
  const lessons = courseModule.lessons || []
  if (lessons.length === 0) return 'empty'
  if (lessons.some((lesson) => lesson.generationStatus === 'pending')) return 'pending'
  if (lessons.some((lesson) => lesson.generationStatus === 'degraded')) return 'degraded'
  return 'ready'
}

// A partially generated module used to be labelled the same flat "Not
// generated" as one with nothing at all. This computes the truthful count
// instead of collapsing it.
function moduleBadge(courseModule) {
  const status = moduleStatus(courseModule)
  if (status === 'empty') return null
  if (status === 'ready') return { text: 'Ready', className: 'bg-success/15 text-success' }
  if (status === 'degraded') return { text: 'Fallback', className: 'bg-warning/15 text-warning' }
  const lessons = courseModule.lessons
  const ready = lessons.filter((lesson) => lesson.generationStatus === 'ready').length
  return { text: `${ready} of ${lessons.length} lessons ready`, className: 'bg-surface-raised text-text-muted' }
}

// Shared between the private course page and the read-only demo course view.
// Lesson rows stay real buttons (not links): they are dense, repeated
// navigation controls inside an already-scrollable list, not standalone
// content cards.
export default function ModuleList({ modules, lessonHref }) {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      {modules.map((courseModule, moduleIndex) => {
        const badge = moduleBadge(courseModule)
        return (
          <div key={courseModule._id} className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-accent">
              Module {moduleIndex + 1}: {courseModule.title}
              {badge && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>{badge.text}</span>
              )}
            </h2>
            <div className="space-y-2">
              {courseModule.lessons.map((lesson, lessonIndex) => {
                const lessonBadge = LESSON_BADGE[lesson.generationStatus]
                return (
                  <button
                    key={lesson._id}
                    onClick={() => navigate(lessonHref(lesson))}
                    className="flex w-full items-center justify-between rounded-xl bg-surface-raised px-4 py-3 text-left text-text transition hover:bg-border"
                  >
                    <span>{lessonIndex + 1}. {lesson.title}</span>
                    <span className={`text-xs ${lessonBadge.className}`}>{lessonBadge.text}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
