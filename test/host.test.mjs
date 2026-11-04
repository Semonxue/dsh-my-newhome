// Host-half smoke test: drives the plugin's HTTP handler with fake req/res.
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dshh-home-'))
process.env.DSH_HOME = home
const TEST_HOME = home

const mod = await import(new URL('../lib/index.js', import.meta.url).href)

let handler = null
const disposers = []
const ctx = {
  inject(deps, cb) {
    if (!deps.includes('webServer')) return
    cb({
      webServer: { register(route) { handler = route.handler; return () => { handler = null } } },
      effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
    })
  },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
}

mod.apply(ctx)
if (handler === null) { console.error('FAIL: no route registered'); process.exit(1) }

function req(method, url, headers = {}, body = null) {
  const stream = Readable.from(body === null ? [] : [body])
  stream.method = method
  stream.url = url
  stream.headers = { host: '127.0.0.1:58264', ...headers }
  return stream
}

function res() {
  const out = { status: 0, headers: {}, chunks: [] }
  return {
    out,
    writeHead(code, headers) { out.status = code; out.headers = headers ?? {} },
    end(chunk) { if (chunk !== undefined) out.chunks.push(Buffer.from(chunk)) },
    get body() { return Buffer.concat(out.chunks) },
  }
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// 1. GET state
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/state'), r)
  const json = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('GET /state 200', r.out.status === 200, `status=${r.out.status}`)
  check('default config shape', json?.config?.workspaces?.count === 6 && json?.assets?.background === false)
}

// 2. POST config merge
{
  const r = res()
  await handler(req('POST', '/dsh-my-newhome/config', { 'x-dsh-my-newhome': '1', 'content-type': 'application/json' },
    JSON.stringify({ theme: { mode: 'custom', accent: '#ff5500' }, workspaces: { count: 8 } })), r)
  const json = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('POST /config 200', r.out.status === 200, `status=${r.out.status}`)
  check('merge keeps siblings', json?.config?.theme?.mode === 'custom'
    && json?.config?.theme?.surfaceDark === '#0a0c10'
    && json?.config?.workspaces?.count === 8
    && json?.config?.workspaces?.strategy === 'activity')
}

// 3. fence: no custom header on mutation
{
  const r = res()
  await handler(req('POST', '/dsh-my-newhome/config', { 'content-type': 'application/json' }, '{}'), r)
  check('fence blocks header-less POST', r.out.status === 403, `status=${r.out.status}`)
}
// 4. fence: cross-site
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/state', { 'sec-fetch-site': 'cross-site' }), r)
  check('fence blocks cross-site', r.out.status === 403, `status=${r.out.status}`)
}
// 5. fence: foreign Origin
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/state', { origin: 'https://evil.example' }), r)
  check('fence blocks foreign origin', r.out.status === 403, `status=${r.out.status}`)
}
// 6. desktop shell origin is allowed
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/state', { origin: 'dsh-app://app' }), r)
  check('allows dsh-app://app origin', r.out.status === 200, `status=${r.out.status}`)
}

// 7. upload logo (1x1 png)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
{
  const r = res()
  await handler(req('POST', '/dsh-my-newhome/asset?kind=logo', { 'x-dsh-my-newhome': '1', 'content-type': 'image/png' }, PNG), r)
  const json = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('POST /asset 200', r.out.status === 200, `status=${r.out.status}`)
  check('asset flagged in state', json?.assets?.logo === true && json?.config?.logo?.asset?.ext === 'png')
}

// 8. serve asset + etag
let etag = null
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/asset?kind=logo'), r)
  etag = r.out.headers.etag ?? null
  check('GET /asset 200 png', r.out.status === 200 && r.out.headers['content-type'] === 'image/png'
    && r.body.equals(PNG), `status=${r.out.status} bytes=${r.body.length}`)
  check('etag present', typeof etag === 'string' && etag.length > 2)
}
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/asset?kind=logo', { 'if-none-match': String(etag) }), r)
  check('304 on matching etag', r.out.status === 304, `status=${r.out.status}`)
}

// 9. missing asset
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/asset?kind=background'), r)
  check('404 when no background', r.out.status === 404, `status=${r.out.status}`)
}

// 9b. clearing an asset also drops the file on disk
{
  const before = existsSync(join(TEST_HOME, 'dsh-my-newhome', 'logo.png'))
  const r = res()
  await handler(req('POST', '/dsh-my-newhome/asset/clear?kind=logo', { 'x-dsh-my-newhome': '1' }), r)
  const after = existsSync(join(TEST_HOME, 'dsh-my-newhome', 'logo.png'))
  check('clear removes the stored file', before === true && after === false, `before=${before} after=${after}`)
  const s = res()
  await handler(req('GET', '/dsh-my-newhome/state'), s)
  const json = JSON.parse(s.body.toString())
  check('clear nulls the config entry', json?.assets?.logo === false && json?.config?.logo?.asset === null)
}

// 10. unknown route
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/nope'), r)
  check('404 unknown route', r.out.status === 404, `status=${r.out.status}`)
}

// 11. browser scrape (real Chrome, read-only)
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/browser?refresh=1'), r)
  const json = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('GET /browser 200', r.out.status === 200, `status=${r.out.status}`)
  check('browser has visited entries', Array.isArray(json?.visited) && json.visited.length > 0,
    `source=${json?.source} visited=${json?.visited?.length} bookmarks=${json?.bookmarks?.length} icons=${json?.visited?.filter((v) => v.icon).length}`)
  if (json?.visited?.length) {
    console.log('  top:', json.visited.slice(0, 5).map((v) => `${v.title.slice(0, 26)} (${v.visitCount})`).join(' | '))
  }
}

// 12. usage widgets: config clamps to four cards and normalises the shape
{
  const r = res()
  await handler(req('POST', '/dsh-my-newhome/config', { 'x-dsh-my-newhome': '1', 'content-type': 'application/json' },
    JSON.stringify({ widgets: { enabled: true, items: [
      { id: 'a', type: 'usage', provider: 'ghost' },
      { provider: 'ghost' },
      { id: 'c', type: 'usage', provider: 'ghost' },
      { id: 'd', type: 'usage', provider: 'ghost' },
      { id: 'e', type: 'usage', provider: 'ghost' },
      null,
      { id: 'f', provider: '' },
    ] } })), r)
  const json = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('POST /config accepts widgets', r.out.status === 200, `status=${r.out.status}`)
  check('widgets clamp to 4', Array.isArray(json?.config?.widgets?.items) && json.config.widgets.items.length === 4,
    `items=${json?.config?.widgets?.items?.length}`)
  check('widget items normalised', json.config.widgets.items.every((item) => item.type === 'usage'
    && typeof item.id === 'string' && item.id !== ''))
  check('widget defaults kept', json?.config?.widgets?.refreshMinutes === 5 && json?.config?.widgets?.enabled === true)
}

// 13. GET /usage (no network: every card is an unknown provider)
let usageBody = null
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/usage'), r)
  usageBody = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('GET /usage 200', r.out.status === 200, `status=${r.out.status}`)
  check('usage payload shape', Array.isArray(usageBody?.widgets) && usageBody.widgets.length === 4
    && typeof usageBody.fetchedAt === 'number')
  check('usage cards carry display fields', usageBody.widgets.every((widget) => typeof widget.primary === 'string'
    && typeof widget.detail === 'string' && typeof widget.label === 'string' && typeof widget.tone === 'string'))
  check('unknown provider degrades', usageBody.widgets.every((widget) => widget.kind === 'error' && widget.tone === 'error'))
  check('usage payload never carries a key', /sk-[A-Za-z0-9]/.test(JSON.stringify(usageBody)) === false)
}

// 14. usage refresh bypasses the cache but keeps the shape
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/usage?refresh=1'), r)
  const json = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('GET /usage?refresh=1 200', r.out.status === 200, `status=${r.out.status}`)
  check('refresh keeps card count', json?.widgets?.length === 4)
}

// 15. fence covers the usage route too
{
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/usage', { 'sec-fetch-site': 'cross-site' }), r)
  check('fence blocks cross-site usage', r.out.status === 403, `status=${r.out.status}`)
}

// 16. pure helpers + a fake provider adapter
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  check('compactTokens formats millions', internals.compactTokens(1_234_567) === '1.2M', internals.compactTokens(1_234_567))
  check('compactTokens keeps small numbers', internals.compactTokens(999) === '999')
  check('money formats CNY', internals.money(12.34, 'CNY') === '¥12.34', internals.money(12.34, 'CNY'))
  check('money formats USD', internals.money(12.5, 'USD') === '$12.50')
  check('derefCredential resolves env refs', internals.derefCredential('$HOME').length > 0)
  const clamp = internals.sanitizeWidgetItems({ widgets: { items: [1, 2, 3, 4, 5].map((n) => ({ id: `i${n}`, provider: 'x' })) } })
  check('sanitizeWidgetItems caps at four', clamp.length === 4)

  internals.PROVIDER_DEFS.probe = {
    label: 'Probe',
    keyNames: [],
    dshProviders: [],
    remote: async () => ({ kind: 'balance', primary: 'PROBE-OK', secondary: '余额', detail: 'detail', tone: 'ok' }),
  }
  const ok = await internals.computeUsageWidget({ id: 'p', type: 'usage', provider: 'probe' }, { scope: null })
  check('remote adapter result is normalised', ok.kind === 'balance' && ok.primary === 'PROBE-OK' && ok.label === 'Probe')

  internals.PROVIDER_DEFS.quota = {
    label: 'Quota',
    keyNames: [],
    dshProviders: [],
    remote: async () => ({ kind: 'quota', primary: '∞', secondary: '本周不限', detail: '5 小时窗剩 23% · 2 小时 14 分后重置', breakdown: '本周不限', tone: 'ok' }),
  }
  const quota = await internals.computeUsageWidget({ id: 'q', type: 'usage', provider: 'quota' }, { scope: null })
  check('quota result keeps breakdown', quota.kind === 'quota' && quota.primary === '∞' && quota.breakdown === '本周不限')
  check('formatDuration renders hours', internals.formatDuration(8_109_973) === '2 小时 15 分', internals.formatDuration(8_109_973))
  check('formatDuration renders days', internals.formatDuration(386_109_973) === '4 天 11 小时', internals.formatDuration(386_109_973))
  internals.PROVIDER_DEFS.broken = {
    label: 'Broken',
    keyNames: [],
    dshProviders: ['never-a-provider'],
    remote: async () => { throw new Error('boom') },
  }
  const broken = await internals.computeUsageWidget({ id: 'b', type: 'usage', provider: 'broken' }, { scope: null })
  check('adapter failure degrades to an error card', broken.kind === 'error' && broken.detail.includes('boom'), broken.detail)
}

// 17. Cline Pass: rolling-window adapter (network stubbed, key from env)
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  const calls = []
  const inMs = (ms) => new Date(Date.now() + ms).toISOString()
  process.env.CLINE_PASS_API_KEY = 'test-cline-key'
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} })
    return new Response(JSON.stringify({ success: true, data: { limits: [
      { type: 'five_hour', percentUsed: 22, resetsAt: inMs(2 * 3600_000) },
      { type: 'weekly', percentUsed: 8, resetsAt: inMs(7 * 86_400_000) },
      { type: 'monthly', percentUsed: 80, resetsAt: inMs(17 * 86_400_000) },
    ] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const widget = await internals.computeUsageWidget({ id: 'c', type: 'usage', provider: 'cline-pass' }, { scope: null })
    check('cline pass calls /plan/usage-limits', calls[0]?.url === 'https://api.cline.bot/api/v1/users/me/plan/usage-limits', calls[0]?.url)
    check('cline pass sends a plain bearer key', calls[0]?.headers.authorization === 'Bearer test-cline-key')
    check('cline pass headlines the binding window', widget.kind === 'quota' && widget.primary === '80%'
      && widget.secondary === '本月已用', `${widget.kind}/${widget.primary}/${widget.secondary}`)
    check('cline pass detail lists the other windows', widget.detail.includes('5 小时 22%')
      && widget.detail.includes('本周 8%'), widget.detail)
    check('cline pass breakdown carries resets', widget.breakdown.includes('本月 80%')
      && widget.breakdown.includes('后重置'), widget.breakdown)
    check('cline pass warns near the cap', widget.tone === 'warn', widget.tone)
    check('cline pass never leaks the key', JSON.stringify(widget).includes('test-cline-key') === false)
  } finally {
    globalThis.fetch = realFetch
  }
}

// 18. Cline Pass: OAuth JWTs are retried with the `workos:` prefix
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  const seen = []
  process.env.CLINE_PASS_API_KEY = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2ln'
  globalThis.fetch = async (url, init) => {
    const auth = String(init?.headers?.authorization ?? '')
    seen.push(auth)
    if (auth.startsWith('Bearer workos:') !== true) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
    return new Response(JSON.stringify({ success: true, data: { limits: [
      { type: 'monthly', percentUsed: 12, resetsAt: new Date(Date.now() + 86_400_000).toISOString() },
    ] } }), { status: 200 })
  }
  try {
    const widget = await internals.computeUsageWidget({ id: 'c', type: 'usage', provider: 'cline-pass' }, { scope: null })
    check('cline pass retries OAuth token with workos prefix', seen.length === 2
      && seen[1].startsWith('Bearer workos:eyJ'), seen.join(' | ').slice(0, 60))
    check('cline pass single window still renders', widget.kind === 'quota' && widget.primary === '12%'
      && widget.secondary === '本月已用', `${widget.primary}/${widget.secondary}`)
  } finally {
    globalThis.fetch = realFetch
  }
}

// 19. Cline Pass: a rejected plain API key degrades to an error card, not a retry storm
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  let hits = 0
  process.env.CLINE_PASS_API_KEY = 'sk_bad-key'
  globalThis.fetch = async () => { hits += 1; return new Response('{"error":"Unauthorized"}', { status: 401 }) }
  try {
    const widget = await internals.computeUsageWidget({ id: 'c', type: 'usage', provider: 'cline-pass' }, { scope: null })
    check('cline pass rejected key is not retried', hits === 1, `hits=${hits}`)
    check('cline pass rejected key degrades', widget.kind === 'error' && widget.detail.includes('拒绝'), widget.detail)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.CLINE_PASS_API_KEY
  }
}

// 20. Cline Pass card renders through the real /usage route
{
  const realFetch = globalThis.fetch
  process.env.CLINE_PASS_API_KEY = 'route-cline-key'
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { limits: [
    { type: 'five_hour', percentUsed: 12, resetsAt: new Date(Date.now() + 3600_000).toISOString() },
    { type: 'monthly', percentUsed: 44, resetsAt: new Date(Date.now() + 86_400_000).toISOString() },
  ] } }), { status: 200 })
  try {
    const c = res()
    await handler(req('POST', '/dsh-my-newhome/config', { 'x-dsh-my-newhome': '1', 'content-type': 'application/json' },
      JSON.stringify({ widgets: { enabled: true, items: [{ id: 'w-cline', type: 'usage', provider: 'cline-pass' }] } })), c)
    const u = res()
    await handler(req('GET', '/dsh-my-newhome/usage?refresh=1'), u)
    const json = u.out.status === 200 ? JSON.parse(u.body.toString()) : null
    const widget = json?.widgets?.[0]
    check('GET /usage serves the Cline Pass card', widget?.provider === 'cline-pass' && widget.kind === 'quota'
      && widget.primary === '44%' && widget.secondary === '本月已用', `${widget?.primary}/${widget?.secondary}`)
    check('Cline Pass card keeps label + detail', widget?.label === 'Cline Pass'
      && widget.detail.includes('5 小时 12%'), widget?.detail)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.CLINE_PASS_API_KEY
  }
}

await rm(home, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
