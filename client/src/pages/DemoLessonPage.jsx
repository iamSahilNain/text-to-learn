import { useParams, Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import LessonBody from '../components/LessonBody'
import DemoNotFound from '../components/DemoNotFound'
import {
  DEMO_COURSE,
  getDemoLessonBySlug,
  getAdjacentDemoLessons,
  demoCoursePath,
  demoLessonPath,
} from '../demo/demoData'
import { useDocumentTitle } from '../useDocumentTitle'

const ORDERED = DEMO_COURSE.modules.flatMap((courseModule) => courseModule.lessons)

// The whole course outline sits beside the lesson on wide screens: the reader
// always sees where they are, and a 1440px viewport is not two-thirds margin.
// On narrow screens it moves below the lesson so reading starts immediately.
function CourseOutline({ currentSlug }) {
  return (
    <nav aria-label="Course outline" className="text-sm">
      <Link to={demoCoursePath()} className="font-serif text-lg text-text transition hover:text-accent">
        {DEMO_COURSE.title}
      </Link>
      <p className="mt-0.5 text-xs text-text-muted">Curated sample</p>
      {DEMO_COURSE.modules.map((courseModule, moduleIndex) => (
        <div key={courseModule._id} className="mt-6">
          <p className="text-xs font-medium text-text-muted">
            Module {moduleIndex + 1} · {courseModule.title}
          </p>
          <ol className="mt-2 border-l border-border">
            {courseModule.lessons.map((lesson, lessonIndex) => {
              const current = lesson.slug === currentSlug
              return (
                <li key={lesson._id}>
                  <Link
                    to={demoLessonPath(lesson)}
                    aria-current={current ? 'page' : undefined}
                    className={`-ml-px flex gap-2 border-l-2 py-1.5 pl-4 transition ${
                      current
                        ? 'border-accent font-medium text-text'
                        : 'border-transparent text-text-muted hover:border-border hover:text-text'
                    }`}
                  >
                    <span className="font-mono text-xs leading-5 text-text-muted">{lessonIndex + 1}</span>
                    <span>{lesson.title}</span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
    </nav>
  )
}

function LessonNavCard({ direction, lesson, alignEnd }) {
  return (
    <Link
      to={demoLessonPath(lesson)}
      className={`group block rounded-lg border border-border bg-surface p-5 transition hover:border-text/50 ${
        alignEnd ? 'text-right' : ''
      }`}
    >
      <span className="text-sm text-text-muted">{direction === 'Previous' ? '← Previous' : 'Next →'}</span>
      <span className="mt-1 block font-serif text-xl leading-snug text-text group-hover:text-accent">
        {lesson.title}
      </span>
    </Link>
  )
}

export default function DemoLessonPage() {
  const { courseSlug, lessonSlug } = useParams()
  const lesson = getDemoLessonBySlug(courseSlug, lessonSlug)

  useDocumentTitle(lesson ? `${lesson.title} | Text to Learn` : 'Not found | Text to Learn')

  if (!lesson) {
    return (
      <DemoNotFound
        message="That lesson doesn't exist in this sample."
        linkTo={demoCoursePath()}
        linkLabel="Back to sample course"
      />
    )
  }

  const { previous, next } = getAdjacentDemoLessons(lessonSlug)
  const position = ORDERED.findIndex((entry) => entry.slug === lessonSlug) + 1
  const parentModule = DEMO_COURSE.modules.find((courseModule) => courseModule._id === lesson.module)

  return (
    <AppShell width={1180}>
      <div className="grid gap-12 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16">
        <aside className="order-last lg:order-first lg:sticky lg:top-20 lg:self-start">
          <CourseOutline currentSlug={lessonSlug} />
        </aside>

        <article className="min-w-0 max-w-[720px]">
          <p className="text-sm text-accent">
            {parentModule?.title} · Lesson {position} of {ORDERED.length}
          </p>
          <h1 className="mt-2 text-4xl leading-tight text-text sm:text-[2.75rem]">{lesson.title}</h1>

          <div className="mt-8">
            <LessonBody lesson={lesson} readOnly />
          </div>

          <nav aria-label="Lesson navigation" className="mt-14 grid gap-4 border-t border-border pt-8 sm:grid-cols-2">
            {previous ? <LessonNavCard direction="Previous" lesson={previous} /> : <span aria-hidden="true" />}
            {next ? <LessonNavCard direction="Next" lesson={next} alignEnd /> : <span aria-hidden="true" />}
          </nav>
        </article>
      </div>
    </AppShell>
  )
}
