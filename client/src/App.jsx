import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import Home from './pages/Home'
import CoursesList from './pages/CoursesList'
import CoursePage from './pages/CoursePage'
import LessonPage from './pages/LessonPage'
import DemoCoursePage from './pages/DemoCoursePage'
import DemoLessonPage from './pages/DemoLessonPage'
import DemoNotFound from './components/DemoNotFound'
import { isDemoMode } from './appMode'
import { demoCoursePath } from './demo/demoData'

// Keying each page on its own id makes a same-pattern route change remount
// it: state from the previous resource -- including MCQ selections and a
// stale loading flag -- cannot leak into the next one.
function CourseRoute() {
  const { courseId } = useParams()
  return <CoursePage key={courseId} />
}

function LessonRoute() {
  const { lessonId } = useParams()
  return <LessonPage key={lessonId} />
}

function DemoCourseRoute() {
  const { courseSlug } = useParams()
  return <DemoCoursePage key={courseSlug} />
}

function DemoLessonRoute() {
  const { courseSlug, lessonSlug } = useParams()
  return <DemoLessonPage key={`${courseSlug}/${lessonSlug}`} />
}

// A demo build never mounts the fetch-driven private routes: a direct
// /course/:id or /lesson/:id link says plainly that this deployment only
// serves the sample, rather than silently querying (or pretending to query)
// a private record.
function PrivateRouteInDemoBuild() {
  return (
    <DemoNotFound
      message="This public demo uses a sample course."
      linkTo={demoCoursePath()}
      linkLabel="Explore sample course"
    />
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/demo/:courseSlug" element={<DemoCourseRoute />} />
        <Route path="/demo/:courseSlug/lessons/:lessonSlug" element={<DemoLessonRoute />} />
        {isDemoMode ? (
          <>
            <Route path="/courses" element={<PrivateRouteInDemoBuild />} />
            <Route path="/course/:courseId" element={<PrivateRouteInDemoBuild />} />
            <Route path="/lesson/:lessonId" element={<PrivateRouteInDemoBuild />} />
          </>
        ) : (
          <>
            <Route path="/courses" element={<CoursesList />} />
            <Route path="/course/:courseId" element={<CourseRoute />} />
            <Route path="/lesson/:lessonId" element={<LessonRoute />} />
          </>
        )}
        <Route path="*" element={<DemoNotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

export { CourseRoute, LessonRoute, DemoCourseRoute, DemoLessonRoute }
