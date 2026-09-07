#!/usr/bin/env node
'use strict';

// Backfills the explicit status fields onto documents written before they
// existed. Dry run by default; --apply performs the reviewed writes.
//
// This is metadata only. It never rewrites lesson content, never deletes a
// document, and never runs automatically at startup. Take a backup or
// snapshot before applying it to data you care about.
//
//   npm run migrate:status              # report only
//   npm run migrate:status -- --apply   # write

const mongoose = require('mongoose');
require('dotenv').config();

const {
  effectiveLessonStatus,
  effectiveEnrichmentStatus,
  effectiveOutlineStatus,
  LEGACY_OUTLINE_TITLE_SUFFIX,
  LEGACY_OUTLINE_DESCRIPTION,
} = require('../services/generationStatus');

const BATCH_SIZE = 100;

function parseArgs(argv) {
  const options = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  return options;
}

function has(document, field) {
  return Object.prototype.hasOwnProperty.call(document, field);
}

// The filter repeats every value this proposal was derived from, so a
// concurrent writer's change makes the update match nothing rather than
// silently overwriting it.
function baseFilter(document) {
  return has(document, 'updatedAt')
    ? { _id: document._id, updatedAt: document.updatedAt }
    : { _id: document._id, updatedAt: { $exists: false } };
}

function planLesson(lesson) {
  const set = {};
  const filter = baseFilter(lesson);

  if (!has(lesson, 'generationStatus')) {
    set.generationStatus = effectiveLessonStatus(lesson);
    filter.generationStatus = { $exists: false };
  }

  const enrichment = effectiveEnrichmentStatus(lesson);
  if (!has(lesson, 'enrichmentStatus')) {
    set.enrichmentStatus = enrichment;
    filter.enrichmentStatus = { $exists: false };
  } else if (lesson.enrichmentStatus !== enrichment) {
    set.enrichmentStatus = enrichment;
    filter.enrichmentStatus = lesson.enrichmentStatus;
  }

  if (Object.keys(set).length === 0) return null;
  // Both fields go in one update so neither invalidates the other's filter.
  return { filter, set };
}

// Only a course that already matches the cheap outline markers is worth the
// two extra lookups needed to confirm the module and lesson titles.
async function outlineStatusFor(db, course) {
  const cheapMarkersMatch =
    typeof course.title === 'string' &&
    course.title.endsWith(LEGACY_OUTLINE_TITLE_SUFFIX) &&
    course.description === LEGACY_OUTLINE_DESCRIPTION &&
    (!Array.isArray(course.tags) || course.tags.length === 0);
  if (!cheapMarkersMatch) return 'ready';

  const moduleIds = Array.isArray(course.modules) ? course.modules : [];
  const modules = await db
    .collection('modules')
    .find({ _id: { $in: moduleIds } })
    .project({ title: 1, lessons: 1 })
    .toArray();
  const byId = new Map(modules.map((entry) => [String(entry._id), entry]));
  const ordered = moduleIds.map((id) => byId.get(String(id))).filter(Boolean);

  const lessonIds = ordered.flatMap((entry) => (Array.isArray(entry.lessons) ? entry.lessons : []));
  const lessons = await db
    .collection('lessons')
    .find({ _id: { $in: lessonIds } })
    .project({ title: 1 })
    .toArray();
  const lessonById = new Map(lessons.map((entry) => [String(entry._id), entry]));

  const populated = {
    ...course,
    modules: ordered.map((entry) => ({
      ...entry,
      lessons: (entry.lessons || []).map((id) => lessonById.get(String(id))).filter(Boolean),
    })),
  };
  return effectiveOutlineStatus(populated);
}

async function migrateCollection({ db, name, cursor, plan, apply, report }) {
  const buffer = [];

  async function flush() {
    for (const { document, proposal } of buffer) {
      const id = String(document._id);
      const summary = Object.entries(proposal.set)
        .map(([field, value]) => `${field}=${value}`)
        .join(' ');
      report.proposed.push(`${name} ${id} ${summary}`);
      for (const value of Object.values(proposal.set)) {
        report.counts[value] = (report.counts[value] || 0) + 1;
      }

      if (!apply) continue;
      const result = await db.collection(name).updateOne(proposal.filter, { $set: proposal.set });
      if (result.matchedCount === 1) report.applied += 1;
      // A miss means the document changed under us. It is left alone; the
      // filter is never weakened to force the write through.
      else report.conflicts.push(`${name} ${id}`);
    }
    buffer.length = 0;
  }

  for await (const document of cursor) {
    const proposal = await plan(document);
    if (!proposal) {
      report.unchanged += 1;
      continue;
    }
    buffer.push({ document, proposal });
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_URI;
  if (!uri) {
    // Deliberately does not echo the value or the URI.
    throw new Error('MONGO_URI is not set. Add it to server/.env before running this migration.');
  }

  const report = { proposed: [], counts: {}, unchanged: 0, applied: 0, conflicts: [] };

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const db = mongoose.connection.db;

    await migrateCollection({
      db,
      name: 'lessons',
      cursor: db.collection('lessons').find({}).batchSize(BATCH_SIZE),
      plan: async (lesson) => planLesson(lesson),
      apply: options.apply,
      report,
    });

    await migrateCollection({
      db,
      name: 'courses',
      cursor: db.collection('courses').find({ outlineStatus: { $exists: false } }).batchSize(BATCH_SIZE),
      plan: async (course) => ({
        filter: { ...baseFilter(course), outlineStatus: { $exists: false } },
        set: { outlineStatus: await outlineStatusFor(db, course) },
      }),
      apply: options.apply,
      report,
    });
  } finally {
    await mongoose.disconnect();
  }

  console.log(options.apply ? 'Mode: APPLY' : 'Mode: dry run (pass --apply to write)');
  for (const line of report.proposed) console.log(`  ${line}`);
  console.log(`Documents needing no change: ${report.unchanged}`);
  console.log('Proposed values:', JSON.stringify(report.counts));
  if (options.apply) {
    console.log(`Documents updated: ${report.applied}`);
    if (report.conflicts.length > 0) {
      console.log(`Skipped, changed concurrently: ${report.conflicts.length}`);
      for (const line of report.conflicts) console.log(`  ${line}`);
    }
  }
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, planLesson, outlineStatusFor };
