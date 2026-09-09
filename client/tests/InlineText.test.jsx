import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import InlineText from '../src/components/InlineText'
import { tokenizeInlineText } from '../src/inlineTextTokenizer'
import LessonBlock from '../src/components/LessonBlock'

describe('tokenizeInlineText', () => {
  test('a single inline span becomes one code token', () => {
    expect(tokenizeInlineText('use `useState` here')).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: 'useState' },
      { type: 'text', text: ' here' },
    ])
  })

  test('multiple inline spans on one line', () => {
    expect(tokenizeInlineText('`a` and `b`')).toEqual([
      { type: 'code', text: 'a' },
      { type: 'text', text: ' and ' },
      { type: 'code', text: 'b' },
    ])
  })

  test('an unmatched backtick stays literal text', () => {
    expect(tokenizeInlineText('a `b and c')).toEqual([
      { type: 'text', text: 'a `b and c' },
    ])
  })

  test('adjacent backticks with no content between them stay literal', () => {
    expect(tokenizeInlineText('``')).toEqual([{ type: 'text', text: '``' }])
  })

  test('an empty span between two lone backticks stays literal', () => {
    // `` immediately followed by ` is a run of 2 then a run of 1; neither is
    // a valid nonempty single-backtick span.
    expect(tokenizeInlineText('``x`')).toEqual([{ type: 'text', text: '``x`' }])
  })

  test('a double-backtick run is not a delimiter', () => {
    expect(tokenizeInlineText('this ``is not code`` here')).toEqual([
      { type: 'text', text: 'this ``is not code`` here' },
    ])
  })

  test('a triple-backtick run is not a delimiter', () => {
    expect(tokenizeInlineText('```block``` stays literal')).toEqual([
      { type: 'text', text: '```block``` stays literal' },
    ])
  })

  test('plain text with no backticks is a single text token', () => {
    expect(tokenizeInlineText('nothing special')).toEqual([{ type: 'text', text: 'nothing special' }])
  })

  test('Unicode content inside and outside a span is preserved exactly', () => {
    expect(tokenizeInlineText('café `❤️中文` шаблон')).toEqual([
      { type: 'text', text: 'café ' },
      { type: 'code', text: '❤️中文' },
      { type: 'text', text: ' шаблон' },
    ])
  })

  test('a backtick pair does not span a line break (LF)', () => {
    expect(tokenizeInlineText('a `first\nsecond` b')).toEqual([
      { type: 'text', text: 'a `first' },
      { type: 'text', text: '\n' },
      { type: 'text', text: 'second` b' },
    ])
  })

  test('a backtick pair does not span a line break (CRLF)', () => {
    expect(tokenizeInlineText('a `first\r\nsecond` b')).toEqual([
      { type: 'text', text: 'a `first' },
      { type: 'text', text: '\r\n' },
      { type: 'text', text: 'second` b' },
    ])
  })

  test('a backtick pair does not span a line break (bare CR)', () => {
    expect(tokenizeInlineText('a `first\rsecond` b')).toEqual([
      { type: 'text', text: 'a `first' },
      { type: 'text', text: '\r' },
      { type: 'text', text: 'second` b' },
    ])
  })

  test('a matched span on a single line still works when the text has other lines', () => {
    expect(tokenizeInlineText('one\n`two` three')).toEqual([
      { type: 'text', text: 'one' },
      { type: 'text', text: '\n' },
      { type: 'code', text: 'two' },
      { type: 'text', text: ' three' },
    ])
  })
})

describe('InlineText rendering', () => {
  test('a code span renders as a <code> element, plain text as a text node', () => {
    render(<p><InlineText text="run `npm test` first" /></p>)
    const code = screen.getByText('npm test')
    expect(code.tagName).toBe('CODE')
  })

  test('a malicious-looking string never becomes executable markup', () => {
    const malicious = '<img src=x onerror="alert(1)"> and `<script>alert(2)</script>`'
    const { container } = render(<p><InlineText text={malicious} /></p>)

    // No element was created from the string; it is displayed as inert text.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
    expect(container.textContent).toContain('<script>alert(2)</script>')
  })

  test('code blocks are never passed through InlineText', () => {
    const block = { type: 'code', language: 'js', text: 'const x = `template ${literal}`' }
    const { container } = render(<LessonBlock block={block} />)
    const code = container.querySelector('pre code')
    // The raw text, backticks and all, is retained exactly -- no span/code
    // splitting from inline-backtick parsing.
    expect(code.textContent).toBe('const x = `template ${literal}`')
    expect(code.querySelector('code')).toBeNull()
  })
})
