'use strict';

// Persisted-state classification for lessons and course outlines.
//
// Documents written before these fields existed carry no status at all, so
// every read path has to derive an effective value. The exact shapes the old
// fallback generators produced are recorded here, and only here, because they
// are compatibility rules for historical data -- newly generated content is
// always labelled explicitly at write time and never re-classified by shape.

const LESSON_STATUSES = ['pending', 'ready', 'degraded'];
const OUTLINE_STATUSES = ['ready', 'degraded'];
const ENRICHMENT_STATUSES = ['pending', 'no_key', 'ok', 'no_results', 'unavailable', 'unknown'];

// Exact text the pre-status fallback generators emitted. A near miss is a
// legitimate lesson, not a fallback: these comparisons are equality, never
// substring matches.
const LEGACY_LESSON_FALLBACK_PARAGRAPH =
  'This lesson could not be generated right now. Please try again.';
const LEGACY_OUTLINE_TITLE_SUFFIX = ' (draft — generation degraded)';
const LEGACY_OUTLINE_DESCRIPTION =
  'This course could not be fully generated right now. Try regenerating it.';
const LEGACY_OUTLINE_MODULE_TITLE = 'Getting started';
const LEGACY_OUTLINE_LESSON_TITLES = ['Introduction', 'Overview', 'Next steps'];

function toPlain(document) {
  if (document == null) return document;
  if (typeof document.toObject === 'function') return document.toObject({ depopulate: false });
  return document;
}

function hasContent(lesson) {
  return Array.isArray(lesson?.content) && lesson.content.length > 0;
}

// The complete two-block fallback body: an empty objectives list, a heading
// repeating the lesson title, and the exact apology paragraph.
function matchesLegacyLessonFallback(lesson) {
  const objectives = lesson?.objectives;
  if (Array.isArray(objectives) && objectives.length > 0) return false;
  const content = lesson?.content;
  if (!Array.isArray(content) || content.length !== 2) return false;
  const [heading, paragraph] = content;
  return (
    heading?.type === 'heading' &&
    heading.text === lesson.title &&
    paragraph?.type === 'paragraph' &&
    paragraph.text === LEGACY_LESSON_FALLBACK_PARAGRAPH
  );
}

function effectiveLessonStatus(lesson) {
  const stored = lesson?.generationStatus;
  if (LESSON_STATUSES.includes(stored)) return stored;
  if (!hasContent(lesson)) return 'pending';
  if (matchesLegacyLessonFallback(lesson)) return 'degraded';
  return 'ready';
}

// Every marker of the old fallback outline must match. A course whose title
// merely ends with the suffix is not enough to call real content degraded.
function matchesLegacyOutlineFallback(course) {
  if (typeof course?.title !== 'string') return false;
  if (!course.title.endsWith(LEGACY_OUTLINE_TITLE_SUFFIX)) return false;
  if (course.description !== LEGACY_OUTLINE_DESCRIPTION) return false;
  if (Array.isArray(course.tags) && course.tags.length > 0) return false;

  const modules = course.modules;
  if (!Array.isArray(modules) || modules.length !== 1) return false;
  const [only] = modules;
  if (only?.title !== LEGACY_OUTLINE_MODULE_TITLE) return false;

  const lessons = only.lessons;
  if (!Array.isArray(lessons) || lessons.length !== LEGACY_OUTLINE_LESSON_TITLES.length) return false;
  return lessons.every((lesson, index) => lesson?.title === LEGACY_OUTLINE_LESSON_TITLES[index]);
}

// Requires modules populated far enough to read module and lesson titles.
// Callers that hold only ObjectId references must populate those narrow
// fields first; an unpopulated course can never satisfy the marker check and
// therefore resolves to ready.
function effectiveOutlineStatus(course) {
  const stored = course?.outlineStatus;
  if (OUTLINE_STATUSES.includes(stored)) return stored;
  return matchesLegacyOutlineFallback(course) ? 'degraded' : 'ready';
}

// isEnriched records that an enrichment decision completed, not that videos
// were found. Historical rows that were enriched before the outcome was
// stored resolve to ok when videos exist and unknown otherwise.
function effectiveEnrichmentStatus(lesson) {
  if (lesson?.isEnriched !== true) return 'pending';
  const stored = lesson.enrichmentStatus;
  if (ENRICHMENT_STATUSES.includes(stored) && stored !== 'pending') return stored;
  return Array.isArray(lesson.videos) && lesson.videos.length > 0 ? 'ok' : 'unknown';
}

// Serializers. Each returns a plain JSON object carrying the effective
// fields, leaving the source Mongoose document untouched.
function serializeLesson(lesson) {
  const plain = toPlain(lesson);
  if (plain == null) return plain;
  return {
    ...plain,
    generationStatus: effectiveLessonStatus(plain),
    enrichmentStatus: effectiveEnrichmentStatus(plain),
  };
}

function serializeModule(courseModule) {
  const plain = toPlain(courseModule);
  if (plain == null) return plain;
  if (!Array.isArray(plain.lessons)) return plain;
  return { ...plain, lessons: plain.lessons.map(serializeLesson) };
}

function serializeCourse(course) {
  const plain = toPlain(course);
  if (plain == null) return plain;
  const outlineStatus = effectiveOutlineStatus(plain);
  if (!Array.isArray(plain.modules)) return { ...plain, outlineStatus };
  return { ...plain, outlineStatus, modules: plain.modules.map(serializeModule) };
}

module.exports = {
  LESSON_STATUSES,
  OUTLINE_STATUSES,
  ENRICHMENT_STATUSES,
  LEGACY_LESSON_FALLBACK_PARAGRAPH,
  LEGACY_OUTLINE_TITLE_SUFFIX,
  LEGACY_OUTLINE_DESCRIPTION,
  LEGACY_OUTLINE_MODULE_TITLE,
  LEGACY_OUTLINE_LESSON_TITLES,
  matchesLegacyLessonFallback,
  matchesLegacyOutlineFallback,
  effectiveLessonStatus,
  effectiveOutlineStatus,
  effectiveEnrichmentStatus,
  serializeLesson,
  serializeModule,
  serializeCourse,
};
