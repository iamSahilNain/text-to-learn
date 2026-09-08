'use strict';

const { effectiveLessonStatus } = require('./generationStatus');
const { throwIfSettled } = require('./resilience');

// A single lesson operation, generation and enrichment together, gets this
// much. Each lesson's deadline is the earlier of now + 35s and its parent
// request's deadline.
const LESSON_OPERATION_TOTAL_MS = 35_000;

/**
 * The single generate-and-persist path for one lesson. Both POST
 * /api/lessons/:id/generate and the bulk SSE controller call the instance
 * returned here, so status, enrichment, cancellation and error handling
 * cannot diverge between them.
 *
 * Build one instance when assembling the app and share it across routes.
 */
function createLessonGenerator({ generateLessonSafe, searchVideos }) {
  /**
   * @param {object} args
   * @param {object} args.lesson        Mongoose lesson document (saved in place)
   * @param {string} args.courseTitle
   * @param {string} args.moduleTitle
   * @param {boolean} [args.force]      Replace an already-ready lesson
   * @param {AbortSignal} [args.signal] Parent cancellation
   * @param {number} [args.deadlineAt]  Parent monotonic deadline
   * @returns {Promise<{lesson: object, skipped: boolean}>}
   */
  async function generateAndPersistLesson({
    lesson,
    courseTitle,
    moduleTitle,
    force = false,
    signal,
    deadlineAt,
  }) {
    throwIfSettled(signal, deadlineAt);

    if (!force && effectiveLessonStatus(lesson) === 'ready') {
      // No upstream request, no write. Ready lessons are reused so a retry
      // of a partially degraded course does not pay to regenerate them.
      return { lesson, skipped: true };
    }

    // Generate into locals. Nothing touches the document until a complete
    // replacement is ready, so a failure leaves the previous content intact.
    const { value: generated, generationStatus } = await generateLessonSafe(
      courseTitle,
      moduleTitle,
      lesson.title,
      { signal, deadlineAt }
    );

    // Enrichment is optional, and only worth attempting while the parent
    // operation is still live.
    throwIfSettled(signal, deadlineAt);
    const { videos, enrichmentStatus } = await searchVideos(
      `${courseTitle} ${lesson.title} tutorial`,
      3,
      { signal, deadlineAt }
    );

    // Last check before the write. Once save() has begun its result is
    // allowed to settle -- a committed document is never rolled back by a
    // cancellation that arrived afterwards.
    throwIfSettled(signal, deadlineAt);

    lesson.objectives = generated.objectives || [];
    lesson.content = generated.content;
    lesson.videos = videos;
    lesson.enrichmentStatus = enrichmentStatus;
    lesson.isEnriched = true;
    lesson.generationStatus = generationStatus;
    await lesson.save();

    return { lesson, skipped: false };
  }

  return { generateAndPersistLesson };
}

module.exports = { createLessonGenerator, LESSON_OPERATION_TOTAL_MS };
