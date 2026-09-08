#!/usr/bin/env node
// Repository hygiene checks over tracked files.
//
// 1. Every local Markdown link points at a file that exists.
// 2. No tracked file lives in a generated directory.
// 3. No tracked .env file other than the examples.
//
// This is not a secret scanner. It only checks that nothing obviously
// generated or environment-specific was committed.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const GENERATED_DIRS = ['node_modules/', 'dist/', 'build/', 'coverage/', '.vite/']
const ALLOWED_ENV_FILES = /(^|\/)\.env\.(?:deploy\.)?example$/

// Inline links and reference definitions. Images count too.
const LINK_PATTERN = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|^\s*\[[^\]]+\]:\s*(\S+)/gm

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
}

// External references are not this script's business: an offline CI run must
// not fail because a website is down.
function isExternal(target) {
  return /^(https?:|mailto:|tel:|#)/i.test(target)
}

function resolveTarget(fromFile, target) {
  const withoutFragment = target.split('#')[0].split('?')[0]
  if (withoutFragment === '') return null
  let decoded
  try {
    decoded = decodeURIComponent(withoutFragment)
  } catch {
    decoded = withoutFragment
  }
  // A leading slash means the repository root, not the filesystem root.
  return decoded.startsWith('/')
    ? path.join(process.cwd(), decoded.slice(1))
    : path.resolve(path.dirname(fromFile), decoded)
}

async function checkLinks(files) {
  const problems = []
  for (const file of files.filter((entry) => entry.endsWith('.md'))) {
    const contents = await readFile(file, 'utf8')
    for (const match of contents.matchAll(LINK_PATTERN)) {
      const target = match[1] ?? match[2]
      if (!target || isExternal(target)) continue
      const resolved = resolveTarget(file, target)
      if (resolved === null) continue
      if (!existsSync(resolved)) {
        problems.push(`${file}: link target does not exist: ${target}`)
      }
    }
  }
  return problems
}

function checkCommittedFiles(files) {
  const problems = []
  for (const file of files) {
    for (const directory of GENERATED_DIRS) {
      if (file === directory.slice(0, -1) || file.includes(`/${directory}`) || file.startsWith(directory)) {
        problems.push(`${file}: generated directory should not be committed`)
      }
    }
    const base = path.basename(file)
    if ((base === '.env' || base.startsWith('.env.')) && !ALLOWED_ENV_FILES.test(file)) {
      problems.push(`${file}: environment files other than .env.example must not be committed`)
    }
  }
  return problems
}

const files = trackedFiles()
const problems = [...(await checkLinks(files)), ...checkCommittedFiles(files)]

if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  console.error(`\n${problems.length} problem(s) found.`)
  process.exit(1)
}

console.log(`Checked ${files.length} tracked files: local links resolve, no generated or environment files committed.`)
