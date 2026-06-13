// YouTube enrichment. This is intentionally OPTIONAL: if there is no
// YOUTUBE_API_KEY the app still works, lessons just have no videos attached.
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

/**
 * Search YouTube for videos matching `query`.
 * Returns an array of video objects, or [] when enrichment is unavailable.
 */
async function searchVideos(query, max = 3) {
  // Degrade gracefully when no key is configured — no videos, no crash.
  if (!process.env.YOUTUBE_API_KEY) return [];

  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY,
    q: query,
    part: 'snippet',
    type: 'video',
    maxResults: String(max),
    safeSearch: 'strict',
    relevanceLanguage: 'en',
  });

  // LEARNING CHECKPOINT #2 — External-API resilience (Gemini + YouTube).
  // Naive behaviour: one fetch wrapped in a basic try/catch. On ANY failure
  // (network error, timeout, HTTP 4xx/5xx, quota exhaustion) we silently
  // return [] so lesson generation still succeeds. There is no timeout,
  // no retry/backoff, and no distinction between "transient" and "quota"
  // errors. See LEARNING.md (Checkpoint 2) for what to build.
  try {
    const res = await fetch(`${SEARCH_URL}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).filter((i) => i.id?.videoId).map(toVideo);
  } catch (err) {
    console.error('[youtube] search failed:', err.message);
    return [];
  }
}

module.exports = { searchVideos };
