import InlineText from './InlineText'
import McqBlock from './McqBlock'

export default function LessonBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return (
        <h2 className="mt-10 text-[1.75rem] leading-snug text-text first:mt-0">
          <InlineText text={block.text} />
        </h2>
      )
    case 'paragraph':
      return (
        <p className="font-serif text-[1.0625rem] leading-[1.75] text-text sm:text-lg">
          <InlineText text={block.text} />
        </p>
      )
    case 'code':
      return (
        <div className="overflow-hidden rounded-md bg-code-bg text-code-text">
          {block.language && (
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-1.5 font-mono text-xs text-code-muted">
              <span>{block.language}</span>
            </div>
          )}
          {/* Code blocks are never passed through InlineText: their text is
              retained exactly, with no inline-backtick parsing. */}
          <pre className="overflow-x-auto p-4 text-[13.5px] leading-relaxed">
            <code className="font-mono">{block.text}</code>
          </pre>
        </div>
      )
    case 'mcq':
      return <McqBlock block={block} />
    default:
      return null
  }
}
