'use strict';

const PDFDocument = require('pdfkit');

// Mirrors the layout of client/src/pdf.js (kept as a client-side jsPDF
// fallback) but renders server-side with pdfkit, so the build spec's
// `GET /api/courses/:id/pdf` acceptance criterion is satisfied without a
// browser.
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

/**
 * Stream a whole course to `res` as a downloadable PDF. Only lessons that
 * have actually been generated (content present) get full content --
 * ungenerated lessons are listed as "Not generated yet." so the outline
 * still reads completely.
 */
function streamCoursePdf(course, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug(course.title)}.pdf"`);
  doc.pipe(res);

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

  for (const [mi, mod] of (course.modules || []).entries()) {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.body).text(`Module ${mi + 1}: ${mod.title}`);
    doc.moveDown(0.5);

    for (const [li, lesson] of (mod.lessons || []).entries()) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.body).text(`${mi + 1}.${li + 1}  ${lesson.title}`);
      doc.moveDown(0.3);

      const hasContent = Array.isArray(lesson.content) && lesson.content.length > 0;
      if (!hasContent) {
        doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.faint).text('Not generated yet.');
        doc.moveDown(0.8);
        continue;
      }

      if (lesson.objectives?.length) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.body).text('Objectives:');
        for (const o of lesson.objectives) {
          doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(`-  ${o}`, { indent: 12 });
        }
        doc.moveDown(0.3);
      }

      for (const block of lesson.content) writeBlock(doc, block);

      if (lesson.videos?.length) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.body).text('Related videos:');
        for (const v of lesson.videos) {
          doc.font('Helvetica').fontSize(9).fillColor(COLORS.link).text(`-  ${v.title} - ${v.url}`, { indent: 12 });
        }
      }
      doc.moveDown(1);
    }
  }

  doc.end();
}

// Render one lesson content block into the PDF. Mirrors the on-screen
// LessonBlock switch in client/src/pages/LessonPage.jsx.
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
      (block.options || []).forEach((opt, i) => {
        // Base-14 PDF fonts don't cover a checkmark glyph, so mark the
        // correct option with plain ASCII instead of a unicode symbol.
        const marker = i === block.answer ? '[correct]' : '';
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(`${i + 1}. ${opt} ${marker}`, { indent: 12 });
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

module.exports = { streamCoursePdf };
