'use strict';

// Effective-status resolution for documents written before the explicit
// status fields existed.

const test = require('node:test');
const assert = require('node:assert');

const {
  effectiveLessonStatus,
  effectiveOutlineStatus,
  effectiveEnrichmentStatus,
  serializeCourse,
  serializeLesson,
  LEGACY_LESSON_FALLBACK_PARAGRAPH,
  LEGACY_OUTLINE_TITLE_SUFFIX,
  LEGACY_OUTLINE_DESCRIPTION,
} = require('../../services/generationStatus');

function legacyFallbackLesson(title = 'Introduction') {
  return {
    title,
    objectives: [],
    content: [
      { type: 'heading', text: title },
      { type: 'paragraph', text: LEGACY_LESSON_FALLBACK_PARAGRAPH },
    ],
  };
}

test('a stored lesson status is used verbatim', () => {
  assert.equal(effectiveLessonStatus({ generationStatus: 'pending', content: [{ type: 'heading', text: 'x' }] }), 'pending');
  assert.equal(effectiveLessonStatus({ generationStatus: 'degraded', content: [] }), 'degraded');
  assert.equal(effectiveLessonStatus({ generationStatus: 'ready', content: [] }), 'ready');
});

test('an invalid stored lesson status falls through to shape classification', () => {
  assert.equal(effectiveLessonStatus({ generationStatus: 'generating', content: [] }), 'pending');
});

test('a legacy lesson with no content is pending', () => {
  assert.equal(effectiveLessonStatus({ title: 'A', content: [] }), 'pending');
  assert.equal(effectiveLessonStatus({ title: 'A' }), 'pending');
});

test('a legacy lesson matching the exact fallback signature is degraded', () => {
  assert.equal(effectiveLessonStatus(legacyFallbackLesson()), 'degraded');
});

test('legacy lessons that only resemble the fallback stay ready', () => {
  const withObjectives = { ...legacyFallbackLesson(), objectives: ['Understand x'] };
  assert.equal(effectiveLessonStatus(withObjectives), 'ready');

  const differentHeading = legacyFallbackLesson();
  differentHeading.content[0].text = 'Something else';
  assert.equal(effectiveLessonStatus(differentHeading), 'ready');

  const quotingLesson = {
    title: 'Handling failure',
    objectives: [],
    content: [
      { type: 'heading', text: 'Handling failure' },
      { type: 'paragraph', text: `Users see: "${LEGACY_LESSON_FALLBACK_PARAGRAPH}" when a provider is down.` },
    ],
  };
  assert.equal(
    effectiveLessonStatus(quotingLesson),
    'ready',
    'a lesson that merely quotes the fallback sentence is real content'
  );

  const threeBlocks = legacyFallbackLesson();
  threeBlocks.content.push({ type: 'paragraph', text: 'More.' });
  assert.equal(effectiveLessonStatus(threeBlocks), 'ready');
});

function legacyFallbackCourse() {
  return {
    title: `Rust${LEGACY_OUTLINE_TITLE_SUFFIX}`,
    description: LEGACY_OUTLINE_DESCRIPTION,
    tags: [],
    modules: [
      {
        title: 'Getting started',
        lessons: [{ title: 'Introduction' }, { title: 'Overview' }, { title: 'Next steps' }],
      },
    ],
  };
}

test('a stored outline status is used verbatim', () => {
  const course = { ...legacyFallbackCourse(), outlineStatus: 'ready' };
  assert.equal(effectiveOutlineStatus(course), 'ready');
});

test('a legacy outline is degraded only when every marker matches', () => {
  assert.equal(effectiveOutlineStatus(legacyFallbackCourse()), 'degraded');

  const suffixOnly = legacyFallbackCourse();
  suffixOnly.description = 'A real course about failure modes.';
  assert.equal(
    effectiveOutlineStatus(suffixOnly),
    'ready',
    'the title suffix alone must not condemn a real outline'
  );

  const extraModule = legacyFallbackCourse();
  extraModule.modules.push({ title: 'Advanced', lessons: [] });
  assert.equal(effectiveOutlineStatus(extraModule), 'ready');

  const reordered = legacyFallbackCourse();
  reordered.modules[0].lessons.reverse();
  assert.equal(effectiveOutlineStatus(reordered), 'ready');

  const tagged = legacyFallbackCourse();
  tagged.tags = ['rust'];
  assert.equal(effectiveOutlineStatus(tagged), 'ready');
});

test('an unpopulated course cannot be classified as degraded', () => {
  const course = { ...legacyFallbackCourse(), modules: ['65f0000000000000000000aa'] };
  assert.equal(effectiveOutlineStatus(course), 'ready');
});

test('enrichment status distinguishes untouched, decided and historical lessons', () => {
  assert.equal(effectiveEnrichmentStatus({ isEnriched: false, enrichmentStatus: 'no_key' }), 'pending');
  assert.equal(effectiveEnrichmentStatus({ isEnriched: false }), 'pending');
  assert.equal(effectiveEnrichmentStatus({ isEnriched: true, enrichmentStatus: 'no_key' }), 'no_key');
  assert.equal(effectiveEnrichmentStatus({ isEnriched: true, enrichmentStatus: 'unavailable' }), 'unavailable');
  assert.equal(effectiveEnrichmentStatus({ isEnriched: true, videos: [{ videoId: 'a' }] }), 'ok');
  assert.equal(effectiveEnrichmentStatus({ isEnriched: true, videos: [] }), 'unknown');
});

test('serialization adds effective fields without mutating the source', () => {
  const lesson = legacyFallbackLesson();
  const serialized = serializeLesson(lesson);
  assert.equal(serialized.generationStatus, 'degraded');
  assert.equal(serialized.enrichmentStatus, 'pending');
  assert.equal('generationStatus' in lesson, false, 'the source object stays untouched');

  const course = serializeCourse(legacyFallbackCourse());
  assert.equal(course.outlineStatus, 'degraded');
  assert.equal(course.modules[0].lessons[0].generationStatus, 'pending');
});
