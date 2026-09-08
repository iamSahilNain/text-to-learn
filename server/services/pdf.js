'use strict';

const { pipeline } = require('node:stream/promises');
const PDFDocument = require('pdfkit');

// Server-side course export. Mirrors the layout of client/src/pdf.js, which
// remains the browser fallback.
//
// Uses the base-14 PDF fonts only, so glyph coverage is Latin-1: text
// outside that range renders as substitutes. Embedding a Unicode font would
// fix that and is not part of this export.
const COLORS = {
  body: '#141414',
  muted: '#5a5a5a',
  faint: '#969696',
  code: '#286e3c',
  link: '#3c5ac8',
};

function slug(title) {
  return (title || 'course').replace(/[^\w]+/g, '-').toLowerCase();
}

function createDefaultPdfDocument() {
  return new PDFDocument({ size: 'A4', margin: 48 });
}

function clearPdfHeaders(res) {
  if (res.headersSent) return;
  res.removeHeader('Content-Type');
  res.removeHeader('Content-Disposition');
}

/**
 * Stream a whole course to `res` as a downloadable PDF.
 *
 * Resolves when the response has actually received the last byte, and
 * rejects on a rendering failure or a broken pipeline -- so the caller can
 * report the failure instead of leaving a half-written download and an
 * unhandled stream error behind.
 *
 * Rendering happens before the pipeline is connected: a synchronous render
 * failure then occurs with no headers sent, leaving the ordinary JSON error
 * path available. Once a pipeline is attached it may destroy the response on
 * error, so there is no second chance to send JSON.
 */
async function streamCoursePdf(course, res, { createPdfDocument = createDefaultPdfDocument } = {}) {
  const doc = createPdfDocument();
  // Attached before anything can fail: an unconsumed 'error' on a stream is
  // an uncaught exception. The pipeline below is what reports it.
  doc.on('error', () => {});

  try {
    renderCourse(doc, course);
  } catch (err) {
    doc.destroy();
    clearPdfHeaders(res);
    throw err;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug(course.title)}.pdf"`);

  try {
    // A client disconnect destroys the response, which the pipeline
    // propagates back to the document: production stops rather than
    // rendering a whole course nobody is reading.
    const finished = pipeline(doc, res);
    doc.end();
    await finished;
  } catch (err) {
    clearPdfHeaders(res);
    throw err;
  }
}

function renderCourse(doc, course) {
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.body).text(course.title || 'Untitled course');
  doc.moveDown(0.4);

  if (course.description) {
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted).text(course.description);
    doc.moveDown(0.4);
  }
  if (course.tags?.length) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.faint).text(`Tags: ${course.tags.join(', ')}`);
  }
  doc.moveDown(1);

  for (const [moduleIndex, courseModule] of (course.modules || []).entries()) {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.body).text(`Module ${moduleIndex + 1}: ${courseModule.title}`);
    doc.moveDown(0.5);

    for (const [lessonIndex, lesson] of (courseModule.lessons || []).entries()) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.body)
        .text(`${moduleIndex + 1}.${lessonIndex + 1}  ${lesson.title}`);
      doc.moveDown(0.3);

      const hasContent = Array.isArray(lesson.content) && lesson.content.length > 0;
      if (!hasContent) {
        doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.faint).text('Not generated yet.');
        doc.moveDown(0.8);
        continue;
      }

      if (lesson.objectives?.length) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.body).text('Objectives:');
        for (const objective of lesson.objectives) {
          doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(`-  ${objective}`, { indent: 12 });
        }
        doc.moveDown(0.3);
      }

      for (const block of lesson.content) writeBlock(doc, block);

      if (lesson.videos?.length) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.body).text('Related videos:');
        for (const video of lesson.videos) {
          doc.font('Helvetica').fontSize(9).fillColor(COLORS.link).text(`-  ${video.title} - ${video.url}`, { indent: 12 });
        }
      }
      doc.moveDown(1);
    }
  }
}

// Render one lesson content block. Mirrors the on-screen LessonBlock switch
// in client/src/pages/LessonPage.jsx.
function writeBlock(doc, block) {
  switch (block.type) {
    case 'heading':
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.body).text(block.text);
      doc.moveDown(0.25);
      return;
    case 'paragraph':
      doc.font('Helvetica').fontSize(11).fillColor(COLORS.body).text(block.text);
      doc.moveDown(0.5);
      return;
    case 'code':
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.code).text(block.text);
      doc.moveDown(0.5);
      return;
    case 'mcq': {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.body).text(`Q: ${block.question}`);
      (block.options || []).forEach((option, index) => {
        // The base-14 fonts have no checkmark glyph, so the correct option
        // is marked in plain ASCII.
        const marker = index === block.answer ? '[correct]' : '';
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(`${index + 1}. ${option} ${marker}`, { indent: 12 });
      });
      if (block.explanation) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.muted).text(`Explanation: ${block.explanation}`);
      }
      doc.moveDown(0.5);
      return;
    }
    default:
      return;
  }
}

module.exports = { streamCoursePdf, createDefaultPdfDocument, slug };
