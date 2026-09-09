import InlineText from './InlineText'
import McqBlock from './McqBlock'

export default function LessonBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return (
        <h2 className="text-2xl font-semibold text-text">
          <InlineText text={block.text} />
        </h2>
      )
    case 'paragraph':
      return (
        <p className="leading-relaxed text-text-muted">
          <InlineText text={block.text} />
        </p>
      )
    case 'code':
      return (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {block.language && (
            <div className="border-b border-border px-4 py-1.5 text-xs text-text-muted">{block.language}</div>
          )}
          {/* Code blocks are never passed through InlineText: their text is
              retained exactly, with no inline-backtick parsing. */}
          <pre className="overflow-x-auto p-4 text-sm">
            <code className="font-mono text-success">{block.text}</code>
          </pre>
        </div>
      )
    case 'mcq':
      return <McqBlock block={block} />
    default:
      return null
  }
}
