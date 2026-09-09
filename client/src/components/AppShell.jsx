import { Link } from 'react-router-dom'

const REPO_URL = 'https://github.com/iamSahilNain/text-to-learn'
const DEMO_COURSE_PATH = '/demo/react-fundamentals'

// Every page -- including loading and error states -- renders inside this
// shell, so the dark background and header are never re-declared per page.
export default function AppShell({ children, width = 1120 }) {
  return (
    <div className="app-shell flex flex-col bg-canvas text-text">
      <header className="border-b border-border">
        <div
          className="mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6"
          style={{ maxWidth: 1120 }}
        >
          <Link to="/" className="font-semibold tracking-tight text-text transition hover:text-accent">
            Text to Learn
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to={DEMO_COURSE_PATH} className="text-text-muted transition hover:text-accent">
              Sample course
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-muted transition hover:text-accent"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>
      <main
        className="mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12"
        style={{ maxWidth: width }}
      >
        {children}
      </main>
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
