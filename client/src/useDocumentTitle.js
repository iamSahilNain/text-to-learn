import { useEffect } from 'react'

// Plain document.title assignment -- never innerHTML, never inserted markup.
export function useDocumentTitle(title) {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
}
