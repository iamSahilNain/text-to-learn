'use strict';

// Two guards that stand between the public internet and the endpoints that
// spend money.
//
// Neither is a user system. There are no accounts and no per-user data:
// these exist so a deployed instance is not an open billing endpoint, which
// is a different and much smaller problem than authentication.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { timingSafeEqual } = require('node:crypto');
const { HttpError } = require('../utils/errors');

// Generous enough that ordinary use never notices, small enough that a
// scanner cannot run up a bill before the window closes.
const GENERATION_WINDOW_MS = 15 * 60 * 1000;
const GENERATION_MAX = 20;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_MAX = 600;

function constantTimeEquals(supplied, expected) {
  const left = Buffer.from(String(supplied));
  const right = Buffer.from(String(expected));
  // timingSafeEqual throws on a length mismatch, and the throw would itself
  // reveal the length, so the lengths are compared first and separately.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Requires a shared secret on every /api request when API_ACCESS_TOKEN is
 * set. When it is unset the gate is disabled, so local development and the
 * test suite are unaffected.
 *
 * This is a deployment gate, not authentication: one secret shared by every
 * caller, with no identity behind it.
 */
function createAccessGate(token) {
  if (!token) return null;
  return function requireAccessToken(req, res, next) {
    const supplied = req.get('x-api-token');
    if (supplied && constantTimeEquals(supplied, token)) return next();
    // Deliberately does not distinguish a missing token from a wrong one.
    next(new HttpError(401, 'unauthorized', 'A valid API token is required'));
  };
}

// Rate-limit rejections use the same envelope as every other error.
function limitHandler(req, res, next) {
  next(new HttpError(429, 'rate_limited', 'Too many requests. Please wait and try again.'));
}

function keyGenerator(req) {
  // The IP-derived key normalises IPv6 down to a /64, so one client cannot
  // simply cycle addresses inside its own prefix.
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
    // The three endpoints that each cost a billed model call.
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
