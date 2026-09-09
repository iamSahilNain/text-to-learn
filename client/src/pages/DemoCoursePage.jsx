import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import ModuleList from '../components/ModuleList'
import CourseProgress from '../components/CourseProgress'
import DemoNotFound from '../components/DemoNotFound'
import { getDemoCourse, demoLessonPath } from '../demo/demoData'
import { useDocumentTitle } from '../useDocumentTitle'

export default function DemoCoursePage() {
  const { courseSlug } = useParams()
  const course = getDemoCourse(courseSlug)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useDocumentTitle(course ? `${course.title} | Text to Learn` : 'Not found | Text to Learn')

  if (!course) return <DemoNotFound />

  async function handleExport() {
    setExporting(true)
    setExportError('')
    try {
      const { exportCourseToPdf } = await import('../pdf')
      exportCourseToPdf({ ...course, title: `${course.title} (Sample course)` })
    } catch {
      setExportError('PDF export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <AppShell width={960}>
      <Link to="/" className="mb-8 inline-block text-accent transition hover:text-text">
        ← Home
      </Link>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-accent">Curated sample</p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text transition hover:bg-border disabled:opacity-50"
        >
          {exporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      {exportError && <p role="alert" className="mb-6 text-sm text-danger">{exportError}</p>}

      <h1 className="mb-3 text-4xl font-bold text-text">{course.title}</h1>
      <p className="mb-4 text-text-muted">{course.description}</p>
      {course.tags?.length > 0 && (
        <p className="mb-8 text-sm text-text-muted">{course.tags.join(' · ')}</p>
      )}

      <CourseProgress modules={course.modules} />

      <ModuleList modules={course.modules} lessonHref={demoLessonPath} />
    </AppShell>
  )
}
