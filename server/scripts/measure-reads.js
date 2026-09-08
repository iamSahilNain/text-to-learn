#!/usr/bin/env node
'use strict';

// Measures the latency of repeated GET /api/courses/:id requests against a
// running server.
//
// This is a read benchmark and nothing else. It says how long a populated
// course read takes in the environment the caller names -- not what course
// creation costs, and not what a hosted database would do.
//
//   node scripts/measure-reads.js --course-id <id> --output reads.json

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3001',
  samples: 100,
  warmup: 5,
};
const MIN_SAMPLES = 10;
const MAX_SAMPLES = 1000;

const FLAGS = new Set([
  '--base-url', '--course-id', '--samples', '--warmup', '--output', '--environment', '--sha',
]);

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    // The flag name is checked first, so a typo is reported as a typo
    // rather than as a missing value.
    if (!FLAGS.has(flag)) throw new Error(`Unrecognized argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--base-url': options.baseUrl = value; break;
      case '--course-id': options.courseId = value; break;
      case '--samples': options.samples = Number(value); break;
      case '--warmup': options.warmup = Number(value); break;
      case '--output': options.output = value; break;
      case '--environment': options.environment = value; break;
      default: options.sha = value; break;
    }
  }

  if (!options.courseId) throw new Error('--course-id is required');
  if (!options.output) throw new Error('--output is required');
  if (!Number.isInteger(options.samples) || options.samples < MIN_SAMPLES || options.samples > MAX_SAMPLES) {
    throw new Error(`--samples must be an integer between ${MIN_SAMPLES} and ${MAX_SAMPLES}`);
  }
  if (!Number.isInteger(options.warmup) || options.warmup < 0) {
    throw new Error('--warmup must be a non-negative integer');
  }
  return options;
}

// p95 is the sorted sample at ceil(0.95 * n) - 1.
function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

function summarize(samples) {
  if (samples.length === 0) {
    return { count: 0, minMs: null, medianMs: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

// A sample counts only when the whole body arrived and parsed as a populated
// course. A truncated or error response is recorded as a failure, never as a
// fast read.
async function timeOneRead(url) {
  const startedAt = performance.now();
  const response = await fetch(url);
  if (response.status !== 200) {
    await response.text();
    return { ok: false, reason: `status_${response.status}` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unparseable_body' };
  }
  const elapsedMs = performance.now() - startedAt;
  if (typeof body?._id !== 'string' || !Array.isArray(body.modules)) {
    return { ok: false, reason: 'unexpected_shape' };
  }
  return { ok: true, elapsedMs };
}

async function measure(options, { fetchOnce = timeOneRead } = {}) {
  const url = `${options.baseUrl}/api/courses/${options.courseId}`;

  for (let index = 0; index < options.warmup; index += 1) {
    await fetchOnce(url);
  }

  const samples = [];
  const failures = [];
  for (let index = 0; index < options.samples; index += 1) {
    const result = await fetchOnce(url);
    if (result.ok) samples.push(result.elapsedMs);
    else failures.push(result.reason);
  }

  return {
    timestamp: new Date().toISOString(),
    endpoint: '/api/courses/:id',
    scope: 'db_populated_read over HTTP on the caller-supplied environment',
    environment: options.environment ?? null,
    sha: options.sha ?? null,
    requested: options.samples,
    warmup: options.warmup,
    successes: summarize(samples),
    failures: { count: failures.length, reasons: countBy(failures) },
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await measure(options);
  // Response bodies are never written out, only their timings.
  await require('node:fs/promises').writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.successes));
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, percentile, summarize, measure };
