import { jsPDF } from 'jspdf'

// Export a whole course to PDF. Only lessons that have actually been
// generated (content present) are included — empty lessons are listed as
// "Not generated yet" so the outline still reads completely.
export function exportCourseToPdf(course) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 48
  const maxWidth = pageWidth - margin * 2
  let y = margin

  // Move the cursor down, starting a new page if we'd overflow the bottom.
  function advance(amount) {
    y += amount
    if (y > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
  }

  // Write wrapped text in the given style, paginating as needed.
  function write(text, { size = 11, style = 'normal', color = [20, 20, 20], gap = 6, indent = 0 } = {}) {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(String(text ?? ''), maxWidth - indent)
    const lineHeight = size * 1.35
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin + indent, y)
      y += lineHeight
    }
    advance(gap)
  }

  // --- Course header ---
  write(course.title || 'Untitled course', { size: 22, style: 'bold', gap: 8 })
  if (course.description) write(course.description, { size: 11, color: [90, 90, 90], gap: 6 })
  if (course.tags?.length) write('Tags: ' + course.tags.join(', '), { size: 9, color: [120, 120, 120], gap: 14 })

  course.modules?.forEach((mod, mi) => {
    write(`Module ${mi + 1}: ${mod.title}`, { size: 16, style: 'bold', gap: 8 })

    mod.lessons?.forEach((lesson, li) => {
      write(`${mi + 1}.${li + 1}  ${lesson.title}`, { size: 13, style: 'bold', gap: 6 })

      const hasContent = Array.isArray(lesson.content) && lesson.content.length > 0
      if (!hasContent) {
        write('Not generated yet.', { size: 10, style: 'italic', color: [150, 150, 150], gap: 12 })
        return
      }

      if (lesson.objectives?.length) {
        write('Objectives:', { size: 10, style: 'bold', gap: 2 })
        lesson.objectives.forEach((o) => write('•  ' + o, { size: 10, indent: 12, gap: 2 }))
        advance(4)
      }

      lesson.content.forEach((block) => writeBlock(write, block))

      if (lesson.videos?.length) {
        write('Related videos:', { size: 10, style: 'bold', gap: 2 })
        lesson.videos.forEach((v) => write(`•  ${v.title} — ${v.url}`, { size: 9, color: [60, 90, 200], indent: 12, gap: 2 }))
      }
      advance(14)
    })
  })

  const safeName = (course.title || 'course').replace(/[^\w]+/g, '-').toLowerCase()
  doc.save(`${safeName}.pdf`)
}

// Render one lesson content block into the PDF.
function writeBlock(write, block) {
  switch (block.type) {
    case 'heading':
      return write(block.text, { size: 12, style: 'bold', gap: 4 })
    case 'paragraph':
      return write(block.text, { size: 11, gap: 8 })
    case 'code':
      return write(block.text, { size: 9, color: [40, 110, 60], gap: 8 })
    case 'mcq': {
      write('Q: ' + block.question, { size: 11, style: 'bold', gap: 2 })
      block.options?.forEach((opt, i) => {
        const marker = i === block.answer ? '✓' : ' '
        write(`${marker} ${i + 1}. ${opt}`, { size: 10, indent: 12, gap: 1 })
      })
      if (block.explanation) write('Explanation: ' + block.explanation, { size: 9, style: 'italic', color: [90, 90, 90], gap: 8 })
      return
    }
    default:
      return
  }
}
