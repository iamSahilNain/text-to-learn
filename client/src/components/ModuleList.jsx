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
  if (status === 'ready') return { text: 'Ready', className: 'text-success' }
  if (status === 'degraded') return { text: 'Fallback', className: 'text-warning' }
  const lessons = courseModule.lessons
  const ready = lessons.filter((lesson) => lesson.generationStatus === 'ready').length
  return { text: `${ready} of ${lessons.length} lessons ready`, className: 'text-text-muted' }
}

// Shared between the private course page and the read-only demo course view.
// Lesson rows stay real buttons (not links): they are dense, repeated
// navigation controls inside an already-scrollable list, not standalone
// content cards.
export default function ModuleList({ modules, lessonHref }) {
  const navigate = useNavigate()

  return (
    <div className="space-y-10">
      {modules.map((courseModule, moduleIndex) => {
        const badge = moduleBadge(courseModule)
        return (
          <section key={courseModule._id}>
            <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3 text-2xl text-text">
              <span className="font-sans text-sm text-text-muted">Module {moduleIndex + 1}:</span>{' '}
              <span>{courseModule.title}</span>
              {badge && <span className={`font-sans text-sm ${badge.className}`}>{badge.text}</span>}
            </h2>
            <div className="divide-y divide-border">
              {courseModule.lessons.map((lesson, lessonIndex) => {
                const lessonBadge = LESSON_BADGE[lesson.generationStatus]
                return (
                  <button
                    key={lesson._id}
                    onClick={() => navigate(lessonHref(lesson))}
                    className="group flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-1 py-3.5 text-left transition hover:bg-surface"
                  >
                    <span className="w-6 font-mono text-sm text-text-muted">{lessonIndex + 1}.</span>
                    <span className="flex-1 font-serif text-lg text-text group-hover:text-accent">{lesson.title}</span>
                    <span className={`text-sm ${lessonBadge.className}`}>{lessonBadge.text}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
