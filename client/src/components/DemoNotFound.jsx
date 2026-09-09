import { Link } from 'react-router-dom'
import AppShell, { Centered } from './AppShell'

// Shared by an unresolved demo slug, a private route requested from a demo
// build, and the general catch-all route. Never silently queries a private
// record or pretends an arbitrary id exists.
export default function DemoNotFound({
  message = "That page doesn't exist in this sample.",
  linkTo = '/',
  linkLabel = 'Back home',
}) {
  return (
    <AppShell>
      <Centered>
        <div className="text-center">
          <p className="mb-6 text-xl text-text-muted">{message}</p>
          <Link
            to={linkTo}
            className="rounded-lg bg-action px-4 py-2 text-sm font-medium text-white transition hover:bg-action-hover"
          >
            {linkLabel}
          </Link>
        </div>
      </Centered>
    </AppShell>
  )
}
