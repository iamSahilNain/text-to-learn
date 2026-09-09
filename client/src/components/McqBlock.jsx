import { useState } from 'react'
import InlineText from './InlineText'

export default function McqBlock({ block }) {
  const [selected, setSelected] = useState(null)
  const answered = selected !== null

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="mb-3 font-semibold text-text">
        <InlineText text={block.question} />
      </p>
      <div className="space-y-2">
        {block.options?.map((option, index) => {
          const isAnswer = index === block.answer
          const isPicked = index === selected
          let className = 'bg-surface text-text-muted hover:bg-surface-raised'
          if (answered && isAnswer) className = 'bg-success/15 text-success'
          else if (answered && isPicked) className = 'bg-danger/15 text-danger'
          return (
            <button
              key={index}
              type="button"
              onClick={() => !answered && setSelected(index)}
              disabled={answered}
              className={`w-full rounded-lg border border-border px-4 py-2 text-left transition ${className}`}
            >
              {index + 1}. <InlineText text={option} />
            </button>
          )
        })}
      </div>
      {answered && (
        <div className="mt-4 text-sm">
          <p className={`font-semibold ${selected === block.answer ? 'text-success' : 'text-danger'}`}>
            {selected === block.answer ? 'Correct!' : 'Not quite.'}
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
