// Host-half smoke test: drives the plugin's HTTP handler with fake req/res.
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    && json?.config?.workspaces?.strategy === 'recent')
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

// 17. Cline Pass: the 5-hour window is the headline, weekly/monthly ride in the detail
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  const calls = []
  const inMs = (ms) => new Date(Date.now() + ms).toISOString()
  process.env.CLINE_PASS_API_KEY = 'test-cline-key'
  const serve = (limits) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} })
      return new Response(JSON.stringify({ success: true, data: { limits } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }
  try {
    serve([
      { type: 'five_hour', percentUsed: 22, resetsAt: inMs(2 * 3600_000) },
      { type: 'weekly', percentUsed: 8, resetsAt: inMs(7 * 86_400_000) },
      { type: 'monthly', percentUsed: 40, resetsAt: inMs(17 * 86_400_000) },
    ])
    const widget = await internals.computeUsageWidget({ id: 'c', type: 'usage', provider: 'cline-pass' }, { scope: null })
    check('cline pass calls /plan/usage-limits', calls[0]?.url === 'https://api.cline.bot/api/v1/users/me/plan/usage-limits', calls[0]?.url)
    check('cline pass sends a plain bearer key', calls[0]?.headers.authorization === 'Bearer test-cline-key')
    check('cline pass headlines the 5-hour window', widget.kind === 'quota' && widget.primary === '22%'
      && widget.secondary === '5 小时已用', `${widget.kind}/${widget.primary}/${widget.secondary}`)
    check('cline pass detail lists weekly then monthly', widget.detail === '本周 8% · 本月 40%', widget.detail)
    check('cline pass breakdown carries every window + resets', widget.breakdown.includes('5 小时已用 22%')
      && widget.breakdown.includes('本周已用 8%') && widget.breakdown.includes('本月已用 40%')
      && widget.breakdown.includes('后重置'), widget.breakdown)
    check('cline pass is calm while every window is low', widget.tone === 'ok', widget.tone)
    check('cline pass never leaks the key', JSON.stringify(widget).includes('test-cline-key') === false)

    // The headline stays on the 5-hour window, but the colour follows whichever window is
    // closest to its cap — the monthly one is what actually stops requests.
    serve([
      { type: 'five_hour', percentUsed: 22, resetsAt: inMs(3600_000) },
      { type: 'weekly', percentUsed: 8, resetsAt: inMs(86_400_000) },
      { type: 'monthly', percentUsed: 85, resetsAt: inMs(10 * 86_400_000) },
    ])
    const monthlyHot = await internals.computeUsageWidget({ id: 'c', type: 'usage', provider: 'cline-pass' }, { scope: null })
    check('cline pass keeps the 5-hour headline when a later window is hot',
      monthlyHot.primary === '22%' && monthlyHot.secondary === '5 小时已用', `${monthlyHot.primary}/${monthlyHot.secondary}`)
    check('cline pass colours on the worst window', monthlyHot.tone === 'warn', monthlyHot.tone)

    // The headline follows the 5-hour window, not whichever window happens to be fullest.
    serve([
      { type: 'five_hour', percentUsed: 85, resetsAt: inMs(3600_000) },
      { type: 'weekly', percentUsed: 10, resetsAt: inMs(86_400_000) },
      { type: 'monthly', percentUsed: 20, resetsAt: inMs(10 * 86_400_000) },
    ])
    const near = await internals.computeUsageWidget({ id: 'c', type: 'usage', provider: 'cline-pass' }, { scope: null })
    check('cline pass warns when the 5-hour window is near its cap', near.primary === '85%' && near.tone === 'warn', `${near.primary}/${near.tone}`)
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
      && widget.primary === '12%' && widget.secondary === '5 小时已用', `${widget?.primary}/${widget?.secondary}`)
    check('Cline Pass card keeps label + detail', widget?.label === 'Cline Pass'
      && widget.detail === '本月 44%', widget?.detail)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.CLINE_PASS_API_KEY
  }
}

// 21. MiniMax: remaining percentages are flipped to used ones (network stubbed, key from env)
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  const calls = []
  const inMs = (ms) => Date.now() + ms
  process.env.MINIMAX_CN_API_KEY = 'test-minimax-key'
  const serve = (row) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} })
      return new Response(JSON.stringify({ base_resp: { status_code: 0, status_msg: 'success' }, model_remains: [row] }), { status: 200 })
    }
  }
  try {
    serve({
      model_name: 'general',
      current_interval_remaining_percent: 27,
      current_interval_status: 1,
      remains_time: 2 * 3600_000,
      end_time: inMs(2 * 3600_000),
      current_weekly_remaining_percent: 100,
      current_weekly_status: 3,
      weekly_remains_time: 4 * 86_400_000,
      weekly_end_time: inMs(4 * 86_400_000),
    })
    const widget = await internals.computeUsageWidget({ id: 'm', type: 'usage', provider: 'minimax' }, { scope: null })
    check('minimax calls the coding-plan route', calls[0]?.url === 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains', calls[0]?.url)
    check('minimax flips remaining to used', widget.primary === '73%' && widget.secondary === '5 小时已用', `${widget.primary}/${widget.secondary}`)
    check('minimax weekly-unlimited reads as 不限', widget.detail === '本周不限', widget.detail)
    check('minimax breakdown keeps both windows', widget.breakdown.includes('5 小时已用 73%')
      && widget.breakdown.includes('本周不限'), widget.breakdown)
    check('minimax stays green under the cap', widget.tone === 'ok', widget.tone)

    serve({
      model_name: 'general',
      current_interval_remaining_percent: 0,
      current_interval_status: 1,
      end_time: inMs(3600_000),
      current_weekly_remaining_percent: 40,
      current_weekly_status: 1,
      weekly_end_time: inMs(3 * 86_400_000),
    })
    const full = await internals.computeUsageWidget({ id: 'm', type: 'usage', provider: 'minimax' }, { scope: null })
    check('minimax exhausted 5-hour window reads 100%', full.primary === '100%' && full.secondary === '5 小时已用', `${full.primary}`)
    check('minimax weekly used is derived too', full.detail === '本周 60%', full.detail)
    check('minimax turns amber near the cap', full.tone === 'warn', full.tone)

    serve({
      model_name: 'general',
      current_interval_remaining_percent: 100,
      current_interval_status: 3,
      current_weekly_remaining_percent: 50,
      current_weekly_status: 1,
      weekly_end_time: inMs(3 * 86_400_000),
    })
    const unlimited = await internals.computeUsageWidget({ id: 'm', type: 'usage', provider: 'minimax' }, { scope: null })
    check('minimax unlimited 5-hour window reads 不限', unlimited.primary === '不限' && unlimited.secondary === '', `${unlimited.primary}/${unlimited.secondary}`)
    check('minimax unlimited 5-hour keeps the weekly number', unlimited.detail === '本周 50%', unlimited.detail)
  } finally {
    globalThis.fetch = realFetch
  }
}

// 22. MiniMax: a rejected key arrives as HTTP 200 with base_resp 1004
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'cookie is missing, log in again' } }), { status: 200 })
  try {
    const widget = await internals.computeUsageWidget({ id: 'm', type: 'usage', provider: 'minimax' }, { scope: null })
    check('minimax base_resp gate catches a bad key', widget.kind === 'error' && widget.detail.includes('1004'), widget.detail)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.MINIMAX_CN_API_KEY
  }
}

// 23. OpenCode Go: gateway usage meter (network stubbed, key from env)
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  const calls = []
  const inMs = (ms) => new Date(Date.now() + ms).toISOString()
  const meter = (percent, status = 'ok', ms = 86_400_000) => ({ status, percent, resetsAt: inMs(ms) })
  process.env.OPENCODE_GO_API_KEY = 'test-oc-go-key'
  const serve = (body, status = 200) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} })
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }
  }
  try {
    serve({ usage: { rolling: meter(12, 'ok', 2 * 3600_000), weekly: meter(8), monthly: meter(44) } })
    const widget = await internals.computeUsageWidget({ id: 'g', type: 'usage', provider: 'opencode-go' }, { scope: null })
    check('opencode go calls the gateway usage route', calls[0]?.url === 'https://opencode.ai/inference/go/v1/usage', calls[0]?.url)
    check('opencode go sends a plain bearer key', calls[0]?.headers.authorization === 'Bearer test-oc-go-key')
    check('opencode go headlines the 5-hour window as used %', widget.kind === 'quota' && widget.primary === '12%'
      && widget.secondary === '5 小时已用', `${widget.kind}/${widget.primary}/${widget.secondary}`)
    check('opencode go detail lists weekly then monthly', widget.detail === '本周 8% · 本月 44%', widget.detail)
    check('opencode go breakdown carries every window + resets', widget.breakdown.includes('5 小时已用 12%')
      && widget.breakdown.includes('本周已用 8%') && widget.breakdown.includes('本月已用 44%')
      && widget.breakdown.includes('后重置'), widget.breakdown)
    check('opencode go is green well under the cap', widget.tone === 'ok', widget.tone)
    check('opencode go never leaks the key', JSON.stringify(widget).includes('test-oc-go-key') === false)

    // Percent is the *used* share, so a full 5-hour window must read as nearly done.
    serve({ usage: { rolling: meter(85), weekly: meter(20), monthly: meter(60) } })
    const near = await internals.computeUsageWidget({ id: 'g', type: 'usage', provider: 'opencode-go' }, { scope: null })
    check('opencode go warns near the cap', near.primary === '85%' && near.tone === 'warn', `${near.primary}/${near.tone}`)

    // `status: rate-limited` is the only exhausted state the gateway documents.
    serve({ usage: { rolling: meter(30), weekly: meter(100, 'rate-limited'), monthly: meter(60) } })
    const limited = await internals.computeUsageWidget({ id: 'g', type: 'usage', provider: 'opencode-go' }, { scope: null })
    check('opencode go keeps the 5-hour headline when a later window is blocked', limited.primary === '30%'
      && limited.secondary === '5 小时已用', `${limited.primary}/${limited.secondary}`)
    check('opencode go turns red on the rate-limited verdict', limited.tone === 'error', limited.tone)
    check('opencode go shows the blocked window as used up', limited.detail === '本周 100% · 本月 60%', limited.detail)
    check('opencode go explains the extra-usage fallback', limited.breakdown.includes('Extra Usage'), limited.breakdown)

    // A workspace without a Go subscription is 403 — name it instead of "HTTP 403".
    serve({ type: 'error', error: { type: 'AuthError', message: 'Forbidden' } }, 403)
    const noGo = await internals.computeUsageWidget({ id: 'g', type: 'usage', provider: 'opencode-go' }, { scope: null })
    check('opencode go explains a missing subscription', noGo.kind === 'error'
      && noGo.detail.includes('没有 Go 订阅'), noGo.detail)

    serve({ type: 'error', error: { type: 'AuthError', message: 'Unauthorized' } }, 401)
    const badKey = await internals.computeUsageWidget({ id: 'g', type: 'usage', provider: 'opencode-go' }, { scope: null })
    check('opencode go explains a rejected key', badKey.kind === 'error'
      && badKey.detail.includes('拒绝了这个 key'), badKey.detail)

    const clampLow = internals.opencodeGoMeter('monthly', { status: 'ok', percent: -4, resetsAt: 'x' })
    const clampHigh = internals.opencodeGoMeter('rolling', { status: 'rate-limited', percent: 40 })
    check('opencode go clamps percent into 0–100', clampLow.used === 0 && clampHigh.used === 100, `${clampLow.used}/${clampHigh.used}`)
    check('opencode go flags rate-limited and labels windows', clampHigh.limited === true
      && clampHigh.label === '5 小时' && clampLow.limited === false)
    check('opencode go ignores a non-numeric percent', internals.opencodeGoMeter('weekly', { percent: 'n/a' }) === null)
  } finally {
    globalThis.fetch = realFetch
  }
}

// 24. OpenCode Go: no key means "no remote data", never a network call
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const realFetch = globalThis.fetch
  let hits = 0
  delete process.env.OPENCODE_GO_API_KEY
  delete process.env.OPENCODE_API_KEY
  globalThis.fetch = async () => { hits += 1; return new Response('{}', { status: 200 }) }
  try {
    const widget = await internals.computeUsageWidget({ id: 'g', type: 'usage', provider: 'opencode-go' }, { scope: null })
    check('opencode go without a key never calls the gateway', hits === 0, `hits=${hits}`)
    check('opencode go without a key degrades', widget.kind === 'error' && widget.tone === 'error', widget.kind)
  } finally {
    globalThis.fetch = realFetch
  }
}

// 25. OpenCode Go card renders through the real /usage route
{
  const realFetch = globalThis.fetch
  process.env.OPENCODE_GO_API_KEY = 'route-oc-go-key'
  globalThis.fetch = async () => new Response(JSON.stringify({ usage: {
    rolling: { status: 'ok', percent: 3, resetsAt: new Date(Date.now() + 3600_000).toISOString() },
    weekly: { status: 'ok', percent: 9, resetsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() },
    monthly: { status: 'ok', percent: 21, resetsAt: new Date(Date.now() + 20 * 86_400_000).toISOString() },
  } }), { status: 200 })
  try {
    const c = res()
    await handler(req('POST', '/dsh-my-newhome/config', { 'x-dsh-my-newhome': '1', 'content-type': 'application/json' },
      JSON.stringify({ widgets: { enabled: true, items: [{ id: 'w-go', type: 'usage', provider: 'opencode-go' }] } })), c)
    const u = res()
    await handler(req('GET', '/dsh-my-newhome/usage?refresh=1'), u)
    const json = u.out.status === 200 ? JSON.parse(u.body.toString()) : null
    const widget = json?.widgets?.[0]
    check('GET /usage serves the OpenCode Go card', widget?.provider === 'opencode-go' && widget.kind === 'quota'
      && widget.primary === '3%' && widget.secondary === '5 小时已用', `${widget?.primary}/${widget?.secondary}`)
    check('OpenCode Go card keeps label + detail', widget?.label === 'OpenCode Go'
      && widget.detail === '本周 9% · 本月 21%', widget?.detail)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.OPENCODE_GO_API_KEY
  }
}

// 26. The shared card shape: order is fixed at 5 小时 → 本周 → 本月 whatever the input order
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)
  const card = internals.quotaCard([
    internals.quotaWindow('monthly', { used: 40 }),
    internals.quotaWindow('rolling', { used: 5 }),
    internals.quotaWindow('weekly', { used: 10 }),
  ])
  check('quota card always headlines the 5-hour window', card.primary === '5%' && card.secondary === '5 小时已用', `${card.primary}/${card.secondary}`)
  check('quota card orders weekly before monthly', card.detail === '本周 10% · 本月 40%', card.detail)
  check('quota card tooltip follows the same order', card.breakdown.startsWith('5 小时已用 5%')
    && card.breakdown.indexOf('本周已用 10%') < card.breakdown.indexOf('本月已用 40%'), card.breakdown)
  const unlimited = internals.quotaCard([
    internals.quotaWindow('rolling', { used: 0, unlimited: true }),
    internals.quotaWindow('weekly', { used: 50 }),
  ])
  check('quota card renders an uncapped window as 不限', unlimited.primary === '不限'
    && unlimited.secondary === '' && unlimited.detail === '本周 50%', `${unlimited.primary}/${unlimited.detail}`)
  const missing = internals.quotaCard([internals.quotaWindow('weekly', { used: 33 })])
  check('quota card falls back to the only window', missing.primary === '33%' && missing.secondary === '本周已用', `${missing.primary}/${missing.secondary}`)
  check('quota card rejects an empty window set', internals.quotaCard([]) === null)
}

// 27. The deck ranks by recency by default, and a stored v1 config is migrated once
{
  const { internals } = await import(new URL('../lib/index.js', import.meta.url).href)

  // Pure migration: only a stored activity default is rewritten, an explicit one survives.
  const v1 = { version: 1, workspaces: { enabled: true, count: 6, strategy: 'activity' } }
  const migrated = internals.applyMigrations(v1, structuredClone(v1))
  check('migration maps v1 activity to recent', migrated.migrated === true
    && migrated.config.workspaces.strategy === 'recent' && migrated.config.version === 2)
  const kept = { version: 2, workspaces: { enabled: true, count: 6, strategy: 'activity' } }
  check('migration never rewrites a v2 choice', internals.applyMigrations(kept, structuredClone(kept)).migrated === false
    && internals.applyMigrations(kept, structuredClone(kept)).config.workspaces.strategy === 'activity')

  // End to end: a config file left behind by an older release is upgraded on read and
  // written back once, so the deck stops outranking today's workspace with last month's.
  const dir = join(TEST_HOME, 'dsh-my-newhome')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'config.json'), JSON.stringify({ version: 1, workspaces: { enabled: true, strategy: 'activity' } }), 'utf8')
  const r = res()
  await handler(req('GET', '/dsh-my-newhome/state'), r)
  const json = r.out.status === 200 ? JSON.parse(r.body.toString()) : null
  check('v1 config read migrates to recent', json?.config?.workspaces?.strategy === 'recent', json?.config?.workspaces?.strategy)
  check('v1 config read bumps the version', json?.config?.version === 2, String(json?.config?.version))
  const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
  check('migration is persisted', onDisk.version === 2 && onDisk.workspaces.strategy === 'recent',
    `version=${onDisk.version} strategy=${onDisk.workspaces?.strategy}`)

  // A user who picks 活跃度 after the migration keeps it: the fix must not fight a choice.
  const c = res()
  await handler(req('POST', '/dsh-my-newhome/config', { 'x-dsh-my-newhome': '1', 'content-type': 'application/json' },
    JSON.stringify({ workspaces: { strategy: 'activity' } })), c)
  const again = res()
  await handler(req('GET', '/dsh-my-newhome/state'), again)
  const kept2 = again.out.status === 200 ? JSON.parse(again.body.toString()) : null
  check('explicit activity survives a reload', kept2?.config?.workspaces?.strategy === 'activity', kept2?.config?.workspaces?.strategy)
}

await rm(home, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
