'use strict';

// YouTube enrichment. Optional by design: with no YOUTUBE_API_KEY the app
// still works and lessons simply carry no videos.

const {
  withResilience,
  deadlineIn,
  remainingMs,
  OperationAbortedError,
  GenerationTimeoutError,
} = require('./resilience');

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

const ENRICHMENT_TOTAL_MS = 6_000;
const ENRICHMENT_ATTEMPT_TIMEOUT_MS = 2_000;
const ENRICHMENT_MAX_ATTEMPTS = 3;

// Map one raw YouTube search item to the shape stored on a lesson.
function toVideo(item) {
  const videoId = item.id?.videoId;
  return {
    videoId,
    title: item.snippet?.title || '',
    channel: item.snippet?.channelTitle || '',
    thumbnail: item.snippet?.thumbnails?.medium?.url || '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

// Retry-After is either a whole number of seconds or an HTTP date. Anything
// else, and any value already in the past, is ignored in favour of the
// ordinary jittered backoff.
function parseRetryAfterMs(headerValue) {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const when = Date.parse(headerValue);
  if (Number.isNaN(when)) return undefined;
  const delay = when - Date.now();
  return delay > 0 ? delay : undefined;
}

// One real attempt. Throws with `.status` (and `.retryAfterMs` for a 429) so
// withResilience can apply its policy split.
async function fetchOnce(query, max, signal) {
  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY,
    q: query,
    part: 'snippet',
    type: 'video',
    maxResults: String(max),
    safeSearch: 'strict',
    relevanceLanguage: 'en',
  });

  const res = await fetch(`${SEARCH_URL}?${params}`, { signal });
  if (!res.ok) {
    const err = new Error(`YouTube search failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
    if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
    throw err;
  }

  const data = await res.json();
  return (data.items || []).filter((item) => item.id?.videoId).map(toVideo);
}

/**
 * Search YouTube for videos matching `query`, inside its own six-second
 * stage budget and never beyond the parent deadline.
 *
 * Returns `{ videos, enrichmentStatus }`:
 *   no_key       no YOUTUBE_API_KEY configured, enrichment skipped
 *   ok           the search succeeded and returned results
 *   no_results   the search succeeded and found nothing
 *   unavailable  this optional stage failed or ran out of its own budget
 *
 * Cancellation of the parent operation, and exhaustion of the parent's
 * budget, propagate instead: they are not enrichment failures.
 */
async function searchVideos(query, max = 3, { signal, deadlineAt } = {}) {
  if (!process.env.YOUTUBE_API_KEY) {
    return { videos: [], enrichmentStatus: 'no_key' };
  }

  try {
    const videos = await withResilience(
      (attemptSignal) => fetchOnce(query, max, attemptSignal),
      {
        timeoutMs: ENRICHMENT_ATTEMPT_TIMEOUT_MS,
        maxAttempts: ENRICHMENT_MAX_ATTEMPTS,
        signal,
        deadlineAt: deadlineIn(ENRICHMENT_TOTAL_MS, deadlineAt),
      }
    );
    return { videos, enrichmentStatus: videos.length > 0 ? 'ok' : 'no_results' };
  } catch (err) {
    if (err instanceof OperationAbortedError) throw err;
    // Only this stage's own six seconds may be absorbed. If the parent's
    // budget is what ran out, the parent needs to hear about it.
    if (err instanceof GenerationTimeoutError && remainingMs(deadlineAt) <= 0) throw err;
    console.error(JSON.stringify({ operation: 'youtube_search', status: 'unavailable', error: err?.name || 'Error' }));
    return { videos: [], enrichmentStatus: 'unavailable' };
  }
}

module.exports = {
  searchVideos,
  parseRetryAfterMs,
  ENRICHMENT_TOTAL_MS,
  ENRICHMENT_ATTEMPT_TIMEOUT_MS,
  ENRICHMENT_MAX_ATTEMPTS,
};
