import assert from 'node:assert/strict'

const baseUrl = process.env.SMOKE_URL || 'http://127.0.0.1:3101'
const username = process.env.SMOKE_USERNAME || 'owner'
const password = process.env.SMOKE_PASSWORD || 'smoke-password-not-a-real-secret'
const headers = { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
let healthy = false
for (let attempt = 0; attempt < 30; attempt += 1) {
  const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) }).catch(() => null)
  if (response?.status === 200) { healthy = true; break }
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.ok(healthy, 'container becomes database-ready')
for (const path of ['/', '/courses', '/course/123', '/api/courses']) {
  assert.equal((await fetch(baseUrl + path)).status, 401, `anonymous ${path}`)
  const response = await fetch(baseUrl + path, { headers })
  assert.equal(response.status, 200, `authenticated ${path}`)
  if (!path.startsWith('/api')) assert.match(await response.text(), /<div id="root">/)
}
const html = await (await fetch(baseUrl, { headers })).text()
const asset = html.match(/src="([^"]+\.js)"/)[1]
assert.equal((await fetch(baseUrl + asset)).status, 401)
const javascript = await fetch(baseUrl + asset, { headers })
assert.equal(javascript.status, 200)
assert.ok(!(await javascript.text()).includes(password), 'password is absent from the served bundle')
assert.equal((await fetch(baseUrl + '/api/courses/generate', {
  method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' },
})).status, 403)
assert.equal((await fetch(baseUrl + '/api/unknown', { headers })).status, 404)
console.log('Container smoke passed: readiness, login, SPA deep links, assets, API, cross-origin rejection; no provider calls.')
