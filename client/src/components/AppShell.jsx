import { Link } from 'react-router-dom'

const REPO_URL = 'https://github.com/iamSahilNain/text-to-learn'
const DEMO_COURSE_PATH = '/demo/react-fundamentals'

// Every page -- including loading and error states -- renders inside this
// shell, so the background, header and footer are never re-declared per page.
export default function AppShell({ children, width = 1120 }) {
  return (
    <div className="app-shell flex flex-col bg-canvas text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-canvas/90 backdrop-blur">
        <div
          className="mx-auto flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8"
          style={{ maxWidth: 1180 }}
        >
          <Link to="/" className="font-serif text-xl text-text transition hover:text-accent">
            Text to Learn
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {/* The sample is the only thing a visitor can open with no key and
                no login, so it is a visible control, not a muted link. */}
            <Link
              to={DEMO_COURSE_PATH}
              className="rounded-md border border-text/25 px-3 py-1.5 font-medium text-text transition hover:border-text hover:bg-surface"
            >
              Sample course
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-3 py-1.5 text-text-muted transition hover:text-text"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full flex-1 px-5 py-10 sm:px-8 sm:py-14" style={{ maxWidth: width }}>
        {children}
      </main>

      <footer className="border-t border-border">
        <div
          className="mx-auto flex flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-text-muted sm:px-8"
          style={{ maxWidth: 1180 }}
        >
          <span className="font-serif text-base text-text">Text to Learn</span>
          <div className="flex items-center gap-5">
            <Link to={DEMO_COURSE_PATH} className="transition hover:text-text">
              Sample course
            </Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="transition hover:text-text">
              Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

// A shared vertical-centering wrapper for loading/error/not-found states, so
// they don't each reinvent min-height flex centering.
export function Centered({ children }) {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}>
      {children}
    </div>
  )
}
