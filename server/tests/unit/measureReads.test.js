'use strict';

// Argument handling and statistics for the read benchmark. No server, no
// network: the read function is injected.

const test = require('node:test');
const assert = require('node:assert');

const { parseArgs, percentile, summarize, measure } = require('../../scripts/measure-reads');

const REQUIRED = ['--course-id', 'c1', '--output', 'out.json'];

test('required arguments are enforced and defaults filled in', () => {
  const options = parseArgs(REQUIRED);
  assert.equal(options.courseId, 'c1');
  assert.equal(options.output, 'out.json');
  assert.equal(options.baseUrl, 'http://127.0.0.1:3001');
  assert.equal(options.samples, 100);
  assert.equal(options.warmup, 5);

  assert.throws(() => parseArgs(['--output', 'out.json']), /--course-id is required/);
  assert.throws(() => parseArgs(['--course-id', 'c1']), /--output is required/);
  assert.throws(() => parseArgs([...REQUIRED, '--verbose']), /Unrecognized argument: --verbose/);
  assert.throws(() => parseArgs([...REQUIRED, '--samples']), /Missing value for --samples/);
});

test('the sample count is bounded', () => {
  assert.equal(parseArgs([...REQUIRED, '--samples', '10']).samples, 10);
  assert.equal(parseArgs([...REQUIRED, '--samples', '1000']).samples, 1000);
  for (const bad of ['9', '1001', '10.5', 'many']) {
    assert.throws(() => parseArgs([...REQUIRED, '--samples', bad]), /--samples must be/, `samples=${bad}`);
  }
  assert.throws(() => parseArgs([...REQUIRED, '--warmup', '-1']), /--warmup must be/);
});

test('p95 is the sorted sample at ceil(0.95 * n) - 1', () => {
  const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(percentile(twenty, 0.95), 19);

  const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(hundred, 0.95), 95);

  assert.equal(percentile([7], 0.95), 7);
  assert.equal(percentile([], 0.95), null);
});

test('the summary reports min, median, p95 and max over the successes', () => {
  assert.deepEqual(summarize([5, 1, 4, 2, 3]), {
    count: 5, minMs: 1, medianMs: 3, p95Ms: 5, maxMs: 5,
  });
  assert.deepEqual(summarize([]), {
    count: 0, minMs: null, medianMs: null, p95Ms: null, maxMs: null,
  });
});

test('warmup reads are excluded and failures are counted separately', async () => {
  const timings = [];
  let call = 0;
  const fetchOnce = async () => {
    call += 1;
    timings.push(call);
    if (call <= 3) return { ok: true, elapsedMs: 1000 }; // warmup, discarded
    if (call === 5) return { ok: false, reason: 'status_500' };
    if (call === 6) return { ok: false, reason: 'unexpected_shape' };
    return { ok: true, elapsedMs: call };
  };

  const report = await measure(
    { baseUrl: 'http://x', courseId: 'c1', samples: 10, warmup: 3, environment: 'laptop', sha: 'abc123' },
    { fetchOnce },
  );

  assert.equal(call, 13, '3 warmups plus 10 samples');
  assert.equal(report.successes.count, 8);
  assert.equal(report.failures.count, 2);
  assert.deepEqual(report.failures.reasons, { status_500: 1, unexpected_shape: 1 });
  assert.equal(report.successes.maxMs, 13, 'the discarded warmups do not reach the summary');
  assert.equal(report.environment, 'laptop');
  assert.equal(report.sha, 'abc123');
  assert.equal(report.requested, 10);
  assert.ok(report.scope.includes('db_populated_read'));
});

test('an environment that was not supplied is recorded as unknown, not invented', async () => {
  const report = await measure(
    { baseUrl: 'http://x', courseId: 'c1', samples: 10, warmup: 0 },
    { fetchOnce: async () => ({ ok: true, elapsedMs: 1 }) },
  );
  assert.equal(report.environment, null);
  assert.equal(report.sha, null);
});
