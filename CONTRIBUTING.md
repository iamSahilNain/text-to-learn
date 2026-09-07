# Contributing

## Setup

Follow [README.md](README.md) for the toolchain, the local replica set, and the
environment variables. Node 24.20.0 and npm 11.6.2 are pinned; `engine-strict`
is on, so an install under another major version fails on purpose.

## Before you open a pull request

Bring up the replica set, export `MONGO_URI_TEST`, then:

```bash
node scripts/check.mjs
```

That runs, in order: server unit tests, server integration tests, client tests,
client lint, client production build. It stops at the first failure. Run the
individual commands from the README if you want to iterate on one of them.

## What a change is expected to include

- **Its own tests.** A behaviour change lands with the regression test that
  would have caught it, in the same commit. Do not defer tests to a follow-up.
- **Real assertions.** A test that only restates the implementation is not
  coverage. Do not skip a failing test to get a commit through.
- **Documentation that matches.** If you change a wire contract, a status
  field, a budget or an error code, update [docs/architecture.md](docs/architecture.md)
  in the same change. If you run the checks, record what you actually ran in
  [docs/verification.md](docs/verification.md) — including what you did not run.

## Test boundaries

- Unit tests need no database, no listening socket and no network.
- Integration tests use real Express on loopback and the real test replica set.
  The database name must end in `_test`.
- Gemini and YouTube are always faked. No test reads a developer `.env`, and no
  test makes a billed call.

## Commits and branches

- Work on a branch off `main`; do not commit directly to it.
- Write commit subjects that describe the behaviour that changed. `fix:
  stop generation work when requests are canceled` is useful; `update`,
  `cleanup` and `fix bug` are not.
- Keep a commit to one coherent change, with its tests.
- Never amend or force-push a commit that is already published. Add another
  factual commit instead.

## Do not commit

- `node_modules/`, `client/dist/`, `coverage/`, benchmark output.
- Any `.env` file. Only `.env.example` is tracked, and it holds no real values.
- API keys, connection strings, or generated PDFs used while testing.

Manually edited lockfiles are also out: change `package.json` and let npm
resolve the lock, then commit both together.

## Deployment

This is a single-user demo. It has no accounts, no authorisation and no
cross-process locking, and it binds loopback by default. Exposing it publicly
needs an explicit `HOST` and `CLIENT_ORIGIN`, and needs those gaps closed
first. Please do not add claims to the contrary in the docs.

## Pull requests

The template asks four things: the problem and the resulting behaviour,
implementation notes, verification, and limitations or migration steps. Under
verification, give the commands you ran, the counts you got, and whether the
run used fake or live services. "Tests pass" without either is not evidence.
