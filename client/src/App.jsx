import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import CoursePage from './pages/CoursePage'
import LessonPage from './pages/LessonPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/course/:courseId" element={<CoursePage />} />
        <Route path="/lesson/:lessonId" element={<LessonPage />} />
      </Routes>
    </BrowserRouter>
  )
}
