import { Link } from 'react-router-dom'
import { DEMO_COURSE, demoCoursePath } from '../demo/demoData'

const MODULE_COUNT = DEMO_COURSE.modules.length
const LESSONS = DEMO_COURSE.modules.flatMap((courseModule) => courseModule.lessons)
const QUIZ_COUNT = LESSONS.filter((lesson) => lesson.content.some((block) => block.type === 'mcq')).length

// The sample is the one thing a first-time visitor can open with no key, no
// login and no wait, so it gets a card on the homepage rather than a muted
// link in the header. Counts are computed from the fixture, never asserted.
export default function SampleCourseCard() {
  return (
    <Link
      to={demoCoursePath()}
      className="group block rounded-lg border border-border bg-surface p-6 transition hover:border-text/40 sm:p-7"
    >
      <p className="text-sm text-accent">Curated sample</p>
      <h2 className="mt-2 text-3xl leading-tight text-text">{DEMO_COURSE.title}</h2>
      <p className="mt-3 text-text-muted">{DEMO_COURSE.description}</p>

      <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
        {[
          [MODULE_COUNT, 'modules'],
          [LESSONS.length, 'lessons'],
          [QUIZ_COUNT, 'quizzes'],
        ].map(([count, label]) => (
          <div key={label}>
            <dt className="font-serif text-2xl text-text">{count}</dt>
            <dd className="text-sm text-text-muted">{label}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 font-medium text-text">
        Explore sample course
        <span aria-hidden="true" className="ml-1 inline-block transition group-hover:translate-x-1">
          →
        </span>
      </p>
    </Link>
  )
}
