#!/usr/bin/env node
// Runs every offline check in order and stops at the first failure.
//
// Installs nothing, starts no containers, reads no API keys, repairs no
// lockfiles and touches no application data. Bring up the test replica set
// and export MONGO_URI_TEST first; see README.md.

import { spawnSync } from 'node:child_process'

const STEPS = [
  ['npm', ['--prefix', 'server', 'test']],
  ['npm', ['--prefix', 'server', 'run', 'test:integration']],
  ['npm', ['--prefix', 'client', 'test']],
  ['npm', ['--prefix', 'client', 'run', 'lint']],
  ['npm', ['--prefix', 'client', 'run', 'build']],
]

if (!process.env.MONGO_URI_TEST) {
  console.error(
    'MONGO_URI_TEST is not set. Start the local replica set (see README.md) and export\n' +
    'MONGO_URI_TEST="mongodb://127.0.0.1:27017/text_to_learn_test?replicaSet=rs0&directConnection=true"',
  )
  process.exit(1)
}

for (const [command, args] of STEPS) {
  console.log(`\n=== ${command} ${args.join(' ')} ===`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(' ')} exited with ${result.status}`)
    process.exit(result.status)
  }
}

console.log('\nAll checks passed.')
