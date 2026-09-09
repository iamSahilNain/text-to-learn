import { useState } from 'react'
import InlineText from './InlineText'

export default function McqBlock({ block }) {
  const [selected, setSelected] = useState(null)
  const answered = selected !== null
  const correct = answered && selected === block.answer

  return (
    <div className="mt-10 rounded-lg border border-border bg-surface p-6 sm:p-7">
      <p className="text-sm text-accent">Check your understanding</p>
      <p className="mt-2 font-serif text-xl leading-snug text-text">
        <InlineText text={block.question} />
      </p>
      <div className="mt-5 space-y-2">
        {block.options?.map((option, index) => {
          const isAnswer = index === block.answer
          const isPicked = index === selected
          let className = 'border-border bg-canvas text-text hover:border-text/50'
          if (answered && isAnswer) className = 'border-success bg-success/10 text-text'
          else if (answered && isPicked) className = 'border-danger bg-danger/10 text-text'
          else if (answered) className = 'border-border bg-canvas text-text-muted'
          return (
            <button
              key={index}
              type="button"
              onClick={() => !answered && setSelected(index)}
              disabled={answered}
              className={`flex w-full items-baseline gap-3 rounded-md border px-4 py-3 text-left transition disabled:cursor-default ${className}`}
            >
              <span className="font-mono text-sm text-text-muted">{index + 1}.</span>{' '}
              <InlineText text={option} />
            </button>
          )
        })}
      </div>
      {answered && (
        <div className={`mt-5 border-l-2 pl-4 ${correct ? 'border-success' : 'border-danger'}`}>
          <p className={`font-medium ${correct ? 'text-success' : 'text-danger'}`}>
            {correct ? 'Correct!' : 'Not quite.'}
          </p>
          {block.explanation && (
            <p className="mt-1 text-text-muted">
              <InlineText text={block.explanation} />
            </p>
          )}
        </div>
      )}
    </div>
  )
}
