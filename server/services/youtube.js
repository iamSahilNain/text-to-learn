'use strict';

// YouTube enrichment. This is intentionally OPTIONAL: if there is no
// YOUTUBE_API_KEY the app still works, lessons just have no videos attached.
const { withResilience } = require('./resilience');

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

// Map one raw YouTube search item to the shape we store on a lesson.
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

// One real attempt at the search call. Throws with `.status` (and, for a
// 429, `.retryAfterMs` parsed from `Retry-After`) so withResilience can tell
// a transient failure apart from a quota/rate-limit response.
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
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter && !Number.isNaN(Number(retryAfter))) {
      err.retryAfterMs = Number(retryAfter) * 1000;
    }
    throw err;
  }

  const data = await res.json();
  return (data.items || []).filter((i) => i.id?.videoId).map(toVideo);
}

/**
 * Search YouTube for videos matching `query`. Always resolves -- never
 * throws -- because a failed enrichment must never sink lesson generation
 * (Checkpoint 2's graceful-degradation requirement).
 *
 * Returns `{ videos, enrichmentStatus }`. `enrichmentStatus` is one of:
 *   - 'no_key'     no YOUTUBE_API_KEY configured (enrichment skipped)
 *   - 'ok'         search succeeded and returned results
 *   - 'no_results' search succeeded but found nothing for this query
 *   - 'unavailable' search failed after retries (timeout/5xx/quota/etc.)
 * so a quota-exhausted key is distinguishable from a topic with no videos --
 * previously both silently produced the same `[]`.
 */
async function searchVideos(query, max = 3) {
  if (!process.env.YOUTUBE_API_KEY) {
    return { videos: [], enrichmentStatus: 'no_key' };
  }

  try {
    const videos = await withResilience(
      (signal) => fetchOnce(query, max, signal),
      { timeoutMs: 8_000, maxAttempts: 3 }
    );
    return { videos, enrichmentStatus: videos.length > 0 ? 'ok' : 'no_results' };
  } catch (err) {
    console.error('[youtube] search failed:', err.message);
    return { videos: [], enrichmentStatus: 'unavailable' };
  }
}

module.exports = { searchVideos };
