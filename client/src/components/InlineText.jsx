import { tokenizeInlineText } from '../inlineTextTokenizer'

export default function InlineText({ text }) {
  const tokens = tokenizeInlineText(String(text ?? ''))
  return (
    <>
      {tokens.map((token, index) =>
        token.type === 'code' ? (
          <code
            key={index}
            className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.9em] [overflow-wrap:anywhere]"
          >
            {token.text}
          </code>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </>
  )
}
