// Supports only single-backtick inline code spans within a single line of
// prose. A run of two or more backticks (``like this``) is not a delimiter
// and stays literal, as does an unmatched or empty single-backtick span, or
// a pair of backticks separated by a line break. This is deliberately not a
// markdown parser: no HTML is ever produced from user/model text, only plain
// text nodes and <code> elements.
export function tokenizeInlineText(text) {
  // A backtick pair never spans a line break, so lines are tokenized
  // independently. The line-ending itself (CR, LF or CRLF) is kept as a
  // literal text token rather than folded into whichever line it touches.
  const parts = text.split(/(\r\n|\r|\n)/)
  const tokens = []
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 1) {
      tokens.push({ type: 'text', text: parts[i] })
      continue
    }
    tokens.push(...tokenizeLine(parts[i]))
  }
  return tokens
}

function tokenizeLine(text) {
  const segments = text.split(/(`+)/)
  const tokens = []
  let buffer = ''
  const flush = () => {
    if (buffer) {
      tokens.push({ type: 'text', text: buffer })
      buffer = ''
    }
  }

  let i = 0
  while (i < segments.length) {
    // Even indices are the plain-text runs between backtick groups.
    if (i % 2 === 0) {
      buffer += segments[i]
      i += 1
      continue
    }

    const run = segments[i]
    if (run.length !== 1) {
      // A double/triple/... backtick run is not a delimiter.
      buffer += run
      i += 1
      continue
    }

    // A lone backtick: look ahead for the next lone-backtick run to close it.
    let closeIndex = -1
    for (let k = i + 2; k < segments.length; k += 2) {
      if (segments[k].length === 1) {
        closeIndex = k
        break
      }
    }

    if (closeIndex === -1) {
      buffer += run
      i += 1
      continue
    }

    let content = ''
    for (let k = i + 1; k < closeIndex; k += 1) content += segments[k]

    if (content.length === 0) {
      // An empty span: the opening backtick is literal, retry after it.
      buffer += run
      i += 1
      continue
    }

    flush()
    tokens.push({ type: 'code', text: content })
    i = closeIndex + 1
  }

  flush()
  return tokens
}
