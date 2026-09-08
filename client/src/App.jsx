import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import Home from './pages/Home'
import CoursesList from './pages/CoursesList'
import CoursePage from './pages/CoursePage'
import LessonPage from './pages/LessonPage'

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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/courses" element={<CoursesList />} />
        <Route path="/course/:courseId" element={<CourseRoute />} />
        <Route path="/lesson/:lessonId" element={<LessonRoute />} />
      </Routes>
    </BrowserRouter>
  )
}

export { CourseRoute, LessonRoute }
