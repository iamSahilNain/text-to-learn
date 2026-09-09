import { useParams, Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import LessonBody from '../components/LessonBody'
import DemoNotFound from '../components/DemoNotFound'
import { getDemoLessonBySlug, getAdjacentDemoLessons, demoCoursePath, demoLessonPath } from '../demo/demoData'
import { useDocumentTitle } from '../useDocumentTitle'

export default function DemoLessonPage() {
  const { courseSlug, lessonSlug } = useParams()
  const lesson = getDemoLessonBySlug(courseSlug, lessonSlug)

  useDocumentTitle(lesson ? `${lesson.title} | Text to Learn` : 'Not found | Text to Learn')

  if (!lesson) return <DemoNotFound message="That lesson doesn't exist in this sample." linkTo={demoCoursePath()} linkLabel="Back to sample course" />

  const { previous, next } = getAdjacentDemoLessons(lessonSlug)

  return (
    <AppShell width={760}>
      <Link to={demoCoursePath()} className="mb-8 inline-block text-accent transition hover:text-text">
        ← Back to course
      </Link>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">Curated sample</p>
      <h1 className="mb-6 text-3xl font-bold text-text">{lesson.title}</h1>

      <LessonBody lesson={lesson} readOnly />

      <div className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-6">
        {previous ? (
          <Link to={demoLessonPath(previous)} className="text-sm text-accent transition hover:text-text">
            ← {previous.title}
          </Link>
        ) : <span />}
        {next ? (
          <Link to={demoLessonPath(next)} className="text-sm text-accent transition hover:text-text">
            {next.title} →
          </Link>
        ) : <span />}
      </div>
    </AppShell>
  )
}
