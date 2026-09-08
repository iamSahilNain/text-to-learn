'use strict';

// PDF export against real stream objects. The success case is parsed with
// pdf-lib, which establishes that the bytes are a readable PDF -- not that
// the layout looks good.

const test = require('node:test');
const assert = require('node:assert');
const { PassThrough, Writable } = require('node:stream');
const { PDFDocument } = require('pdf-lib');

const { streamCoursePdf, createDefaultPdfDocument, slug } = require('../../services/pdf');

const COURSE = {
  title: 'Rust Ownership',
  description: 'A short course.',
  tags: ['rust'],
  modules: [
    {
      _id: 'm1',
      title: 'Basics',
      lessons: [
        {
          _id: 'l1',
          title: 'Ownership',
          objectives: ['Understand ownership'],
          content: [
            { type: 'heading', text: 'Ownership' },
            { type: 'paragraph', text: 'Rust tracks who owns each value.' },
            { type: 'code', language: 'rust', text: 'let s = String::from("hi");' },
            { type: 'mcq', question: 'Who owns it?', options: ['s', 'nobody'], answer: 0, explanation: 'Ownership moves.' },
          ],
          videos: [{ title: 'Ownership in Rust', url: 'https://example.test/v' }],
        },
        { _id: 'l2', title: 'Borrowing', content: [] },
      ],
    },
  ],
};

// A response stand-in with the header surface the exporter uses.
function fakeResponse() {
  const stream = new PassThrough();
  stream.chunks = [];
  stream.on('data', (chunk) => stream.chunks.push(chunk));
  stream.headers = {};
  stream.headersSent = false;
  stream.setHeader = (name, value) => { stream.headers[name] = value; };
  stream.removeHeader = (name) => { delete stream.headers[name]; };
  stream.getHeader = (name) => stream.headers[name];
  return stream;
}

test('a successful export resolves after writing a parseable PDF', async () => {
  const res = fakeResponse();
  await streamCoursePdf(COURSE, res);

  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="rust-ownership.pdf"');

  const bytes = Buffer.concat(res.chunks);
  assert.ok(bytes.length > 0);
  const parsed = await PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount() >= 1, 'the export must produce at least one page');
});

test('a synchronous render failure rejects with no headers left behind', async () => {
  const res = fakeResponse();
  const boom = new Error('render exploded');
  const createPdfDocument = () => {
    const doc = createDefaultPdfDocument();
    doc.text = () => { throw boom; };
    return doc;
  };

  await assert.rejects(() => streamCoursePdf(COURSE, res, { createPdfDocument }), /render exploded/);
  assert.equal(res.headersSent, false);
  assert.deepEqual(res.headers, {}, 'PDF-only headers are cleared so JSON can still be sent');
  assert.equal(res.chunks.length, 0);
});

// A destination that accepts the first chunk and then stalls, so a failure
// can be injected while the pipeline is genuinely mid-flight.
function stallingResponse() {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      stream.firstWrite?.();
      stream.firstWrite = null;
      // Never calls back: the pipeline stays open until it is destroyed.
    },
  });
  stream.headers = {};
  stream.headersSent = false;
  stream.setHeader = (name, value) => { stream.headers[name] = value; };
  stream.removeHeader = (name) => { delete stream.headers[name]; };
  stream.getHeader = (name) => stream.headers[name];
  return stream;
}

test('an asynchronous stream failure rejects instead of hanging', async () => {
  const res = stallingResponse();
  const failure = new Error('destination exploded');
  res.firstWrite = () => setImmediate(() => res.destroy(failure));

  await assert.rejects(() => streamCoursePdf(COURSE, res), /destination exploded/);
});

test('a client disconnect destroys the producer instead of rendering on', async () => {
  const res = stallingResponse();
  let doc;
  const createPdfDocument = () => {
    doc = createDefaultPdfDocument();
    return doc;
  };
  res.firstWrite = () => setImmediate(() => res.destroy());

  await assert.rejects(() => streamCoursePdf(COURSE, res, { createPdfDocument }));
  assert.equal(doc.destroyed, true, 'PDF production must stop when nobody is reading');
});

test('no unhandled rejection escapes a failing export', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const res = stallingResponse();
    res.firstWrite = () => setImmediate(() => res.destroy(new Error('gone')));
    await streamCoursePdf(COURSE, res).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('the filename slug keeps working for awkward titles', () => {
  assert.equal(slug('Rust: Ownership & Borrowing'), 'rust-ownership-borrowing');
  assert.equal(slug('Trailing punctuation!'), 'trailing-punctuation-');
  assert.equal(slug(''), 'course');
  assert.equal(slug(undefined), 'course');
});


test('a synchronous end failure destroys the pipeline without an unhandled rejection', async () => {
  const res = fakeResponse();
  const doc = createDefaultPdfDocument();
  doc.end = () => { throw new Error('end exploded'); };
  await assert.rejects(() => streamCoursePdf(COURSE, res, { createPdfDocument: () => doc }), /end exploded/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(doc.destroyed, true);
  assert.equal(res.destroyed, true);
});
