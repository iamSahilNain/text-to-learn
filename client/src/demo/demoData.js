import { REACT_FUNDAMENTALS_COURSE } from './reactFundamentals'

// The only sample published today. A second sample would add another entry
// here and to DEMO_COURSE_SLUG, not change how lookups work.
export const DEMO_COURSE_SLUG = 'react-fundamentals'
export const DEMO_COURSE = REACT_FUNDAMENTALS_COURSE

const ORDERED_LESSONS = DEMO_COURSE.modules.flatMap((courseModule) => courseModule.lessons)

export function demoCoursePath() {
  return `/demo/${DEMO_COURSE_SLUG}`
}

export function demoLessonPath(lesson) {
  return `/demo/${DEMO_COURSE_SLUG}/lessons/${lesson.slug}`
}

export function getDemoCourse(slug) {
  return slug === DEMO_COURSE_SLUG ? DEMO_COURSE : null
}

// Requires the parent course slug too: a lesson slug alone is not enough to
// resolve a route once there is more than one sample, and even with only one
// today, /demo/wrong-course/lessons/<real-slug> must not silently resolve.
export function getDemoLessonBySlug(courseSlug, lessonSlug) {
  if (courseSlug !== DEMO_COURSE_SLUG) return null
  return ORDERED_LESSONS.find((lesson) => lesson.slug === lessonSlug) || null
}

// Ordered siblings for Previous/Next navigation, derived once from the
// fixture's own module/lesson order.
export function getAdjacentDemoLessons(slug) {
  const index = ORDERED_LESSONS.findIndex((lesson) => lesson.slug === slug)
  if (index === -1) return { previous: null, next: null }
  return {
    previous: index > 0 ? ORDERED_LESSONS[index - 1] : null,
    next: index < ORDERED_LESSONS.length - 1 ? ORDERED_LESSONS[index + 1] : null,
  }
}
