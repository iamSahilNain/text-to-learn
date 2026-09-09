import { useState } from 'react'
import { useParams } from 'react-router-dom'
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
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Curated sample</p>
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
      <div className="mb-8 flex flex-wrap gap-2">
        {course.tags?.map((tag) => (
          <span key={tag} className="rounded-full bg-accent/15 px-3 py-1 text-sm text-accent">
            {tag}
          </span>
        ))}
      </div>

      <CourseProgress modules={course.modules} />

      <ModuleList modules={course.modules} lessonHref={demoLessonPath} />
    </AppShell>
  )
}
