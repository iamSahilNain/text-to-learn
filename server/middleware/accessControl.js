'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { timingSafeEqual, createHash } = require('node:crypto');
const { HttpError } = require('../utils/errors');

const GENERATION_WINDOW_MS = 15 * 60 * 1000;
const GENERATION_MAX = 20;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_MAX = 600;

function constantTimeEquals(supplied, expected) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

// A single private-app login, kept entirely on the server. TLS is supplied
// by Caddy. No credentials are compiled into the browser bundle.
function createAccessGate({ username, password } = {}) {
  if (!username && !password) return null;
  if (!username || !password || /[:\x00-\x1f\x7f]/.test(username) || password.length < 16) {
    throw new Error('Set APP_USERNAME and APP_PASSWORD (at least 16 characters)');
  }
  return function requireLogin(req, res, next) {
    const header = req.get('authorization') || '';
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
    const supplied = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
    if (constantTimeEquals(supplied, `${username}:${password}`)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Text-to-Learn", charset="UTF-8"');
    next(new HttpError(401, 'unauthorized', 'A valid app login is required'));
  };
}

// Rate-limit rejections use the same envelope as every other error.
function limitHandler(req, res, next) {
  next(new HttpError(429, 'rate_limited', 'Too many requests. Please wait and try again.'));
}

function keyGenerator(req) {
  // Group IPv6 addresses using the library default subnet mask.
  return ipKeyGenerator(req.ip);
}

function createRateLimiters({ generationMax = GENERATION_MAX, globalMax = GLOBAL_MAX } = {}) {
  const common = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    handler: limitHandler,
  };
  return {
    // Applies to every /api route, generation included.
    global: rateLimit({ ...common, windowMs: GLOBAL_WINDOW_MS, limit: globalMax }),
    // Generation requests may each make multiple provider calls.
    generation: rateLimit({ ...common, windowMs: GENERATION_WINDOW_MS, limit: generationMax }),
  };
}

module.exports = {
  createAccessGate,
  createRateLimiters,
  GENERATION_WINDOW_MS,
  GENERATION_MAX,
  GLOBAL_WINDOW_MS,
  GLOBAL_MAX,
};
