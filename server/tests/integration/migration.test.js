'use strict';

// Legacy status backfill against the real test replica set.

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { testDatabaseUri } = require('./helpers/database');
const {
  LEGACY_LESSON_FALLBACK_PARAGRAPH,
  LEGACY_OUTLINE_TITLE_SUFFIX,
  LEGACY_OUTLINE_DESCRIPTION,
} = require('../../services/generationStatus');
const { main, planLesson } = require('../../scripts/migrate-generation-status');

const { MongoClient, ObjectId } = mongoose.mongo;
const uri = testDatabaseUri();

const ids = {
  pendingLesson: new ObjectId(),
  fallbackLesson: new ObjectId(),
  overviewLesson: new ObjectId(),
  nextStepsLesson: new ObjectId(),
  nearMissLesson: new ObjectId(),
  readyLesson: new ObjectId(),
  alreadyLabelled: new ObjectId(),
  fallbackModule: new ObjectId(),
  realModule: new ObjectId(),
  fallbackCourse: new ObjectId(),
  realCourse: new ObjectId(),
};

// Lessons and a course exactly as the pre-status code wrote them: no
// generationStatus, no outlineStatus, enrichmentStatus defaulted to no_key.
function fixtures() {
  const stamp = new Date('2026-01-01T00:00:00.000Z');
  return {
    lessons: [
      { _id: ids.pendingLesson, title: 'Untouched', objectives: [], content: [], videos: [], enrichmentStatus: 'no_key', isEnriched: false, createdAt: stamp, updatedAt: stamp },
      {
        _id: ids.fallbackLesson,
        title: 'Introduction',
        objectives: [],
        content: [
          { type: 'heading', text: 'Introduction' },
          { type: 'paragraph', text: LEGACY_LESSON_FALLBACK_PARAGRAPH },
        ],
        videos: [], enrichmentStatus: 'no_key', isEnriched: true, createdAt: stamp, updatedAt: stamp,
      },
      { _id: ids.overviewLesson, title: 'Overview', objectives: [], content: [], videos: [], enrichmentStatus: 'no_key', isEnriched: false, createdAt: stamp, updatedAt: stamp },
      { _id: ids.nextStepsLesson, title: 'Next steps', objectives: [], content: [], videos: [], enrichmentStatus: 'no_key', isEnriched: false, createdAt: stamp, updatedAt: stamp },
      {
        _id: ids.nearMissLesson,
        title: 'Failure modes',
        objectives: [],
        content: [
          { type: 'heading', text: 'Failure modes' },
          { type: 'paragraph', text: `Users see "${LEGACY_LESSON_FALLBACK_PARAGRAPH}" when the provider is down.` },
        ],
        videos: [], enrichmentStatus: 'no_results', isEnriched: true, createdAt: stamp, updatedAt: stamp,
      },
      {
        _id: ids.readyLesson,
        title: 'Borrowing',
        objectives: ['Understand borrowing'],
        content: [{ type: 'paragraph', text: 'Real generated prose.' }],
        videos: [{ videoId: 'abc', title: 'Borrowing', channel: 'c', thumbnail: '', url: 'https://example.test/abc' }],
        isEnriched: true, createdAt: stamp, updatedAt: stamp,
      },
      {
        _id: ids.alreadyLabelled,
        title: 'Lifetimes',
        objectives: [],
        content: [{ type: 'paragraph', text: 'Already classified.' }],
        videos: [], generationStatus: 'ready', enrichmentStatus: 'ok', isEnriched: true, createdAt: stamp, updatedAt: stamp,
      },
    ],
    modules: [
      { _id: ids.fallbackModule, title: 'Getting started', course: ids.fallbackCourse, lessons: [ids.fallbackLesson, ids.overviewLesson, ids.nextStepsLesson], createdAt: stamp, updatedAt: stamp },
      { _id: ids.realModule, title: 'Memory', course: ids.realCourse, lessons: [ids.pendingLesson, ids.nearMissLesson, ids.readyLesson, ids.alreadyLabelled], createdAt: stamp, updatedAt: stamp },
    ],
    courses: [
      { _id: ids.fallbackCourse, title: `Rust${LEGACY_OUTLINE_TITLE_SUFFIX}`, description: LEGACY_OUTLINE_DESCRIPTION, tags: [], modules: [ids.fallbackModule], createdAt: stamp, updatedAt: stamp },
      { _id: ids.realCourse, title: `Systems programming${LEGACY_OUTLINE_TITLE_SUFFIX}`, description: 'A real course whose title happens to end the same way.', tags: ['systems'], modules: [ids.realModule], createdAt: stamp, updatedAt: stamp },
    ],
  };
}

async function withDatabase(run) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    return await run(client.db());
  } finally {
    await client.close();
  }
}

async function seed() {
  await withDatabase(async (db) => {
    for (const name of ['lessons', 'modules', 'courses']) await db.collection(name).deleteMany({});
    const data = fixtures();
    await db.collection('lessons').insertMany(data.lessons);
    await db.collection('modules').insertMany(data.modules);
    await db.collection('courses').insertMany(data.courses);
  });
}

// main() owns its own mongoose connection, so it must run with no test
// connection held open.
async function runMigration(args) {
  const previousArgv = process.argv;
  const previousUri = process.env.MONGO_URI;
  const previousLog = console.log;
  process.argv = ['node', 'migrate-generation-status.js', ...args];
  process.env.MONGO_URI = uri;
  console.log = () => {};
  try {
    return await main();
  } finally {
    process.argv = previousArgv;
    process.env.MONGO_URI = previousUri;
    console.log = previousLog;
  }
}

test('an unrecognized flag fails instead of guessing', async () => {
  await assert.rejects(() => runMigration(['--force']), /Unrecognized argument: --force/);
});

test('a dry run reports every proposal and writes nothing', async () => {
  await seed();
  const before = await withDatabase((db) => db.collection('lessons').find({}).toArray());

  const report = await runMigration([]);

  assert.equal(report.applied, 0);
  assert.ok(report.proposed.length > 0);
  assert.ok(report.counts.pending > 0);
  assert.ok(report.counts.degraded > 0);
  assert.ok(report.counts.ready > 0);

  const after = await withDatabase((db) => db.collection('lessons').find({}).toArray());
  assert.deepEqual(after, before, 'a dry run must not touch a single document');
});

test('applying classifies each fixture and preserves content and timestamps', async () => {
  await seed();
  await runMigration(['--apply']);

  const { lessons, courses } = await withDatabase(async (db) => ({
    lessons: new Map((await db.collection('lessons').find({}).toArray()).map((l) => [String(l._id), l])),
    courses: new Map((await db.collection('courses').find({}).toArray()).map((c) => [String(c._id), c])),
  }));

  const pending = lessons.get(String(ids.pendingLesson));
  assert.equal(pending.generationStatus, 'pending');
  assert.equal(pending.enrichmentStatus, 'pending', 'no_key with isEnriched:false was never an enrichment decision');

  assert.equal(lessons.get(String(ids.fallbackLesson)).generationStatus, 'degraded');

  const nearMiss = lessons.get(String(ids.nearMissLesson));
  assert.equal(nearMiss.generationStatus, 'ready', 'legacy prose must not be downgraded to pending or degraded');
  assert.equal(nearMiss.enrichmentStatus, 'no_results');

  const ready = lessons.get(String(ids.readyLesson));
  assert.equal(ready.generationStatus, 'ready');
  assert.equal(ready.enrichmentStatus, 'ok', 'an enriched lesson with videos resolves to ok');
  assert.deepEqual(ready.content, [{ type: 'paragraph', text: 'Real generated prose.' }]);
  assert.deepEqual(ready.objectives, ['Understand borrowing']);
  assert.deepEqual(ready.updatedAt, new Date('2026-01-01T00:00:00.000Z'), 'a metadata write must not bump updatedAt');

  assert.equal(lessons.get(String(ids.alreadyLabelled)).generationStatus, 'ready');

  assert.equal(courses.get(String(ids.fallbackCourse)).outlineStatus, 'degraded');
  assert.equal(
    courses.get(String(ids.realCourse)).outlineStatus,
    'ready',
    'a matching title suffix alone is not enough to call an outline degraded'
  );
});

test('a second run applies zero writes', async () => {
  await seed();
  await runMigration(['--apply']);
  const afterFirst = await withDatabase((db) => db.collection('lessons').find({}).sort({ _id: 1 }).toArray());

  const second = await runMigration(['--apply']);
  assert.equal(second.applied, 0);
  assert.equal(second.proposed.length, 0);
  assert.equal(second.conflicts.length, 0);

  const afterSecond = await withDatabase((db) => db.collection('lessons').find({}).sort({ _id: 1 }).toArray());
  assert.deepEqual(afterSecond, afterFirst);
});

test('a proposal whose document changed underneath it matches nothing', async () => {
  await seed();

  await withDatabase(async (db) => {
    const lessons = db.collection('lessons');
    const stale = await lessons.findOne({ _id: ids.pendingLesson });
    const proposal = planLesson(stale);
    assert.ok(proposal, 'the untouched legacy lesson needs a backfill');
    assert.deepEqual(proposal.filter.updatedAt, stale.updatedAt, 'the filter pins the value it was derived from');

    // Another writer touches the document between the read and the write.
    await lessons.updateOne({ _id: ids.pendingLesson }, { $set: { updatedAt: new Date() } });

    const result = await lessons.updateOne(proposal.filter, { $set: proposal.set });
    assert.equal(result.matchedCount, 0, 'a stale proposal must not be forced through');

    const untouched = await lessons.findOne({ _id: ids.pendingLesson });
    assert.equal(untouched.generationStatus, undefined);
  });
});

test('cleanup leaves the test database empty', async () => {
  await withDatabase(async (db) => {
    for (const name of ['lessons', 'modules', 'courses']) await db.collection(name).deleteMany({});
  });
});
