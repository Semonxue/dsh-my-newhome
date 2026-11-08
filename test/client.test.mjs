// Client-half smoke test: loads the browser bundle with a stub React and drives the pure
// ranking helpers. No DOM, no harness — the factory body only defines functions, so
// evaluating it catches module-scope errors and pins the deck's ordering contract:
// "最近工作区" must put the workspace used five minutes ago above the one used last month.
import { readFileSync } from 'node:fs'

const captured = { factory: null }
const windowStub = {
  __ModuleLoader__: {
    load(options) { captured.factory = options.factory },
  },
}

const noop = () => {}
const ReactStub = {
  createElement: () => null,
  useEffect: noop,
  useMemo: noop,
  useRef: () => ({ current: null }),
  useState: (initial) => [initial, noop],
  useReducer: (initial) => [initial, noop],
}

function requireStub(id) {
  if (id === 'react') return ReactStub
  if (id === 'react-dom/client') return { createRoot: () => ({ render: noop, unmount: noop }) }
  throw new Error(`unexpected require: ${id}`)
}

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
new Function('window', source)(windowStub)
if (captured.factory === null) {
  console.error('FAIL: client bundle never registered on window.__ModuleLoader__')
  process.exit(1)
}
const plugin = captured.factory(requireStub)
const internals = plugin && plugin.internals

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

check('client bundle exports name/inject/apply', plugin?.name === 'dsh-my-newhome'
  && Array.isArray(plugin.inject) && typeof plugin.apply === 'function')
check('test surface stays off the enumerable exports', internals !== undefined
  && Object.keys(plugin).sort().join(',') === 'apply,inject,name')
if (internals === undefined) {
  console.error('FAIL: no internals surface')
  process.exit(1)
}

const DAY = 86_400_000
const now = Date.now()

/** One session-list row, shaped like the harness' projection store. */
function summary(ageMs, turns = 4, extra = {}) {
  const at = now - ageMs
  return {
    updatedAt: at,
    blank: false,
    projectionValues: {
      timeContext: { lastMessageTime: at },
      sessionStats: { turns },
    },
    ...extra,
  }
}

const busy = {
  workspaceId: 'busy-old',
  title: 'busy-old',
  path: '/work/busy',
  sessionIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
  createdAt: new Date(now - 120 * DAY).toISOString(),
  updatedAt: new Date(now - 10 * DAY).toISOString(),
}
const fresh = {
  workspaceId: 'fresh',
  title: 'fresh',
  path: '/work/fresh',
  sessionIds: ['f1'],
  createdAt: new Date(now - DAY).toISOString(),
  updatedAt: new Date(now - 5 * 60_000).toISOString(),
}
const middle = {
  workspaceId: 'middle',
  title: 'middle',
  path: '/work/middle',
  sessionIds: ['m1', 'm2'],
  createdAt: new Date(now - 30 * DAY).toISOString(),
  updatedAt: new Date(now - 3 * DAY).toISOString(),
}

function stores(overrides = {}) {
  const store = { items: [busy, middle, fresh], archivedSessionIds: [], ...overrides }
  const sessions = {
    byId: {
      b1: summary(10 * DAY), b2: summary(11 * DAY), b3: summary(12 * DAY),
      b4: summary(13 * DAY), b5: summary(14 * DAY),
      m1: summary(4 * DAY), m2: summary(3 * DAY),
      f1: summary(5 * 60_000),
    },
    ...overrides.sessions,
  }
  return { store, sessions }
}

// The reported bug: a busy project from last month used to outrank the workspace the user
// was in five minutes ago, because v1 defaulted to a half-life weighted activity score.
{
  const { store, sessions } = stores()
  const rows = internals.rankWorkspaces(store, sessions, { count: 6, strategy: 'recent' })
  check('recent puts the just-used workspace first', rows[0]?.id === 'fresh', rows.map((row) => row.id).join(' > '))
  check('recent orders by last activity', rows.map((row) => row.id).join(' > ') === 'fresh > middle > busy-old',
    rows.map((row) => row.id).join(' > '))
  check('recent keeps the card metrics', rows[0]?.sessions === 1 && rows[0]?.turns === 4,
    `sessions=${rows[0]?.sessions} turns=${rows[0]?.turns}`)
}
{
  const { store, sessions } = stores()
  const rows = internals.rankWorkspaces(store, sessions, { count: 6 })
  check('recent is the default strategy', rows[0]?.id === 'fresh', rows.map((row) => row.id).join(' > '))
}
{
  const { store, sessions } = stores()
  const rows = internals.rankWorkspaces(store, sessions, { count: 6, strategy: 'nonsense' })
  check('an unknown strategy falls back to recent', rows[0]?.id === 'fresh', rows.map((row) => row.id).join(' > '))
}

// The old behaviour stays available, it just is not the default any more.
{
  const { store, sessions } = stores()
  const rows = internals.rankWorkspaces(store, sessions, { count: 6, strategy: 'activity', halfLifeDays: 14 })
  check('activity still ranks by decayed volume', rows[0]?.id === 'busy-old', rows.map((row) => row.id).join(' > '))
  const sessionsRank = internals.rankWorkspaces(store, sessions, { count: 6, strategy: 'sessions' })
  check('sessions ranks by session count', sessionsRank[0]?.id === 'busy-old' && sessionsRank[1]?.id === 'middle',
    sessionsRank.map((row) => row.id).join(' > '))
}

// Archived, blank and subagent rows are not activity, and the record stamp is a floor so
// a renamed workspace never claims an older time than its own record.
{
  const { store, sessions } = stores({ archivedSessionIds: ['f1'] })
  const rows = internals.rankWorkspaces(store, sessions, { count: 6, strategy: 'recent' })
  const freshRow = rows.find((row) => row.id === 'fresh')
  check('archived sessions do not count', freshRow?.sessions === 0, `sessions=${freshRow?.sessions}`)
  // Opening/renaming a workspace stamps its record, so an archived-only workspace is still
  // ranked by when the record last moved — it just has no session activity to add.
  check('an archived-only workspace keeps its record time', freshRow?.lastActive === Date.parse(fresh.updatedAt),
    new Date(freshRow?.lastActive ?? 0).toISOString())
  check('an archived-only workspace still ranks by that time', rows[0]?.id === 'fresh',
    rows.map((row) => row.id).join(' > '))
}
{
  // A stale record with no live sessions is genuinely idle and must fall to the bottom.
  const { store, sessions } = stores({ archivedSessionIds: ['f1'] })
  const stale = { ...fresh, updatedAt: new Date(now - 60 * DAY).toISOString() }
  const rows = internals.rankWorkspaces({ ...store, items: [busy, middle, stale] }, sessions, { count: 6, strategy: 'recent' })
  check('a workspace with no activity at all drops last', rows[rows.length - 1]?.id === 'fresh',
    rows.map((row) => row.id).join(' > '))
}
{
  const { store, sessions } = stores()
  sessions.byId.f1 = summary(5 * 60_000, 4, { origin: 'subagent' })
  const rows = internals.rankWorkspaces(store, sessions, { count: 6, strategy: 'recent' })
  check('subagent sessions are ignored', rows.find((row) => row.id === 'fresh')?.sessions === 0)
}
{
  const { store, sessions } = stores()
  sessions.byId.f1 = summary(5 * 60_000, 4, { blank: true })
  const rows = internals.rankWorkspaces(store, sessions, { count: 6, strategy: 'recent' })
  check('blank sessions are ignored', rows.find((row) => row.id === 'fresh')?.sessions === 0)
}

// Rows are capped by the configured count (3–8, clamped by the deck).
{
  const { store, sessions } = stores()
  const rows = internals.rankWorkspaces(store, sessions, { count: 8 })
  check('row count is clamped to the deck', rows.length === 3)
  const capped = stores().store
  const many = { ...capped, items: [...capped.items, { ...middle, workspaceId: 'extra', sessionIds: [] }] }
  check('count ceiling never exceeds eight', internals.rankWorkspaces(many, stores().sessions, { count: 99 }).length <= 8)
  check('count floor is three', internals.rankWorkspaces(many, stores().sessions, { count: 1 }).length >= 3)
}

// Card metadata helpers.
{
  const at = now - 12 * 60_000
  check('sessionTime prefers the last message', internals.sessionTime(summary(12 * 60_000)) === at)
  check('sessionTime falls back to updatedAt', internals.sessionTime({ updatedAt: at }) === at)
  check('sessionTime tolerates an unknown row', internals.sessionTime(null) === 0)
  check('sessionTurns reads the stats block', internals.sessionTurns(summary(1, 9)) === 9)
  check('ago renders 刚刚', internals.ago(now - 30_000) === '刚刚', internals.ago(now - 30_000))
  check('ago renders minutes', internals.ago(now - 5 * 60_000) === '5 分钟前', internals.ago(now - 5 * 60_000))
  check('ago renders hours', internals.ago(now - 3 * 3_600_000) === '3 小时前', internals.ago(now - 3 * 3_600_000))
  check('ago renders days', internals.ago(now - 2 * DAY) === '2 天前', internals.ago(now - 2 * DAY))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
