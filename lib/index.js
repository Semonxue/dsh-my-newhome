// dsh-my-newhome — host half.
//
// Responsibilities:
//   * own the plugin data dir ($DSH_HOME/dsh-my-newhome): config.json + image assets
//   * serve a small local HTTP API under /dsh-my-newhome (state / config / asset / browser)
//   * read the locally installed Chrome profile (bookmarks + most-visited) so the
//     homepage can offer "browser entries" with zero manual work
//
// Everything here uses only `node:` builtins on purpose: a third-party plugin cannot
// assume the harness' node_modules resolve from inside the profile.

import { mkdir, readFile, writeFile, rename, stat, copyFile, unlink, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-my-newhome'

const API = '/dsh-my-newhome'
const ROOT = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-my-newhome')
const CONFIG_FILE = join(ROOT, 'config.json')
const MAX_UPLOAD = 32 * 1024 * 1024

const DEFAULT_CONFIG = {
  version: 2,
  theme: {
    mode: 'follow', // 'follow' = adopt the harness light/dark, 'custom' = our palette
    accent: '#4f7cff',
    surfaceDark: '#0a0c10',
    surfaceLight: '#f6f7fb',
  },
  background: {
    enabled: false,
    fit: 'cover',
    opacity: 1,
    blur: 0,
    dim: 0.28,
    asset: null, // { ext, version }
  },
  logo: {
    asset: null, // { ext, version }
    hideHeroTagline: false,
    wordmark: '', // sidebar text; empty keeps the harness wordmark slot hidden
  },
  workspaces: {
    enabled: true,
    count: 6,
    // recent = the workspace whose sessions were active last wins; that is what the deck
    // is titled after. activity (half-life weighted) and sessions stay opt-in.
    strategy: 'recent', // recent | activity | sessions
    halfLifeDays: 14,
    place: 'above', // above = input.dock (above composer) | below = same slot, flex-ordered below
    onlyOnHero: true, // hide the deck once a conversation is actually running
  },
  links: {
    auto: true,
    autoCount: 6,
    place: 'below',
    items: [], // user entries: { title, url, icon? }
  },
  widgets: {
    enabled: true,
    refreshMinutes: 5,
    items: [], // up to 4: { id, type: 'usage', provider: 'deepseek' | 'minimax' | ... }
  },
}

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}
const EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

// ── config ────────────────────────────────────────────────────────────────────

function merge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = base?.[key]
    out[key] = value !== null && typeof value === 'object' && !Array.isArray(value) && current !== null && typeof current === 'object' && !Array.isArray(current)
      ? merge(current, value)
      : value
  }
  return out
}

/**
 * A stored config from an older release is upgraded in place on read.
 *
 * v1 shipped `activity` as the default ordering: a half-life weighted score where a
 * long-running project from two weeks ago outranks the workspace opened five minutes
 * ago. The deck is titled 「最近工作区」, so that reads as a sorting bug. v2 ranks by
 * true recency; the old value is migrated once, and picking 活跃度 in the settings
 * panel afterwards pins it for good.
 */
function applyMigrations(stored, merged) {
  const version = Number(stored !== null && typeof stored === 'object' ? stored.version : 0) || 1
  if (version >= 2) return { config: merged, migrated: false }
  const workspaces = merged.workspaces
  if (workspaces !== null && typeof workspaces === 'object' && workspaces.strategy === 'activity') {
    workspaces.strategy = 'recent'
  }
  merged.version = 2
  return { config: merged, migrated: true }
}

async function readConfig() {
  let stored
  try {
    stored = JSON.parse(await readFile(CONFIG_FILE, 'utf8'))
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
  const { config, migrated } = applyMigrations(stored, merge(structuredClone(DEFAULT_CONFIG), stored))
  // Best effort: a read-only $DSH_HOME must not take the homepage down, it just keeps
  // re-migrating in memory.
  if (migrated) await writeConfig(config).catch(() => {})
  return config
}

async function writeConfig(next) {
  await mkdir(ROOT, { recursive: true })
  const tmp = `${CONFIG_FILE}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(tmp, CONFIG_FILE)
}

// ── http helpers ──────────────────────────────────────────────────────────────

function send(res, code, payload, type = 'application/json; charset=utf-8') {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'content-length': body.length })
  res.end(body)
}

/**
 * The route is reachable from any process that can hit the loopback port, so keep a
 * light fence: loopback host, no cross-site fetch, same-origin (the desktop shell
 * presents `dsh-app://app`, hence the `app` allowance) and a custom header that a
 * plain HTML form cannot set.
 */
function trusted(req, { mutation }) {
  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase()
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      const { hostname, protocol } = new URL(origin)
      const ok = hostname === host || hostname === 'localhost' || (protocol === 'dsh-app:' && hostname === 'app')
      if (!ok) return false
    } catch {
      return false
    }
  }
  if (mutation && req.headers['x-dsh-my-newhome'] !== '1') return false
  return true
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_UPLOAD) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ── assets ────────────────────────────────────────────────────────────────────

async function saveAsset(kind, buffer, contentType) {
  const ext = MIME_EXT[String(contentType ?? '').split(';')[0].trim()] ?? 'png'
  await mkdir(ROOT, { recursive: true })
  const file = join(ROOT, `${kind}.${ext}`)
  await writeFile(file, buffer)
  // drop the previous extension so the dir never accumulates stale copies
  for (const other of Object.keys(EXT_MIME)) {
    if (other === ext) continue
    const stale = join(ROOT, `${kind}.${other}`)
    if (existsSync(stale)) await unlink(stale).catch(() => {})
  }
  return { ext, version: Date.now() }
}

async function dropAsset(kind) {
  for (const ext of Object.keys(EXT_MIME)) {
    const stale = join(ROOT, `${kind}.${ext}`)
    if (existsSync(stale)) await unlink(stale).catch(() => {})
  }
}

async function assetPath(kind, asset) {
  if (asset === null || typeof asset !== 'object' || typeof asset.ext !== 'string') return null
  const file = join(ROOT, `${kind}.${asset.ext}`)
  try {
    const info = await stat(file)
    return info.isFile() ? { file, size: info.size, mtimeMs: info.mtimeMs } : null
  } catch {
    return null
  }
}

// ── browser (Chrome) ─────────────────────────────────────────────────────────

const CHROME_ROOT = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
let browserCache = { at: 0, value: null }
const BROWSER_TTL = 5 * 60 * 1000

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, maxBuffer: 48 * 1024 * 1024, ...options }, (error, stdout) => {
      resolve(error ? { ok: false, error: String(error.message ?? error) } : { ok: true, stdout })
    })
  })
}

async function chromeProfileDir() {
  let profile = 'Default'
  try {
    const local = JSON.parse(await readFile(join(CHROME_ROOT, 'Local State'), 'utf8'))
    const last = local?.profile?.last_used
    if (typeof last === 'string' && existsSync(join(CHROME_ROOT, last))) profile = last
  } catch {}
  const dir = join(CHROME_ROOT, profile)
  return existsSync(dir) ? { profile, dir } : null
}

function walkBookmarks(node, out) {
  if (node === null || typeof node !== 'object') return
  if (node.type === 'url' && typeof node.url === 'string') out.push({ title: String(node.name ?? node.url), url: node.url })
  for (const child of node.children ?? []) walkBookmarks(child, out)
}

async function readBookmarks(dir) {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'Bookmarks'), 'utf8'))
    const bar = []
    walkBookmarks(raw?.roots?.bookmark_bar, bar)
    const rest = []
    walkBookmarks(raw?.roots?.other, rest)
    walkBookmarks(raw?.roots?.synced, rest)
    return { bar: bar.slice(0, 40), other: rest.slice(0, 40) }
  } catch {
    return { bar: [], other: [] }
  }
}

function chromeTime(micro) {
  const n = Number(micro)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n / 1000 - 11644473600000)
}

function isJunk(url) {
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url)
    || /^https?:\/\/(www\.)?google\.[a-z.]+\/search/i.test(url)
    || /^https?:\/\/(www\.)?bing\.com\/search/i.test(url)
}

async function sqliteJson(file, sql) {
  // Chrome keeps the DB locked while running; a temp copy sidesteps SQLITE_BUSY.
  const copy = join(tmpdir(), `dsh-my-newhome-chrome-${randomUUID()}.sqlite`)
  try {
    await copyFile(file, copy)
    const result = await run('/usr/bin/sqlite3', ['-json', copy, sql])
    if (!result.ok) return null
    const text = result.stdout.trim()
    return text === '' ? [] : JSON.parse(text)
  } catch {
    return null
  } finally {
    if (existsSync(copy)) await unlink(copy).catch(() => {})
  }
}

async function readFavicon(dir, pageUrl) {
  const escaped = pageUrl.replace(/'/g, "''")
  const rows = await sqliteJson(join(dir, 'Favicons'),
    `select hex(f.image_data) as hex from icon_mapping m join favicon_bitmaps f on f.icon_id = m.icon_id where m.page_url = '${escaped}' order by f.width desc limit 1`)
  const hex = Array.isArray(rows) && rows[0]?.hex ? String(rows[0].hex) : ''
  if (hex === '' || hex === 'null') return null
  const bytes = Buffer.from(hex, 'hex')
  if (bytes.length === 0 || bytes.length > 96 * 1024) return null
  return `data:image/png;base64,${bytes.toString('base64')}`
}

function hostOfUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** One batched read for the exact URLs, then a host-level fallback for the misses. */
async function readFavicons(dir, entries) {
  const icons = new Map()
  const escaped = (value) => value.replace(/'/g, "''")
  const urls = entries.map((entry) => entry.url).slice(0, 24)
  if (urls.length === 0) return icons
  const rows = await sqliteJson(join(dir, 'Favicons'),
    `select m.page_url as page, hex(f.image_data) as hex from icon_mapping m
       join favicon_bitmaps f on f.icon_id = m.icon_id
       where m.page_url in (${urls.map((url) => `'${escaped(url)}'`).join(',')})
         and length(f.image_data) > 0
       order by f.width desc`)
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const page = String(row.page ?? '')
      if (page === '' || icons.has(page) || !row.hex || row.hex === 'null') continue
      const bytes = Buffer.from(String(row.hex), 'hex')
      if (bytes.length === 0 || bytes.length > 96 * 1024) continue
      icons.set(page, `data:image/png;base64,${bytes.toString('base64')}`)
    }
  }
  const missing = entries.filter((entry) => !icons.has(entry.url)).slice(0, 12)
  for (const entry of missing) {
    const host = hostOfUrl(entry.url)
    if (host === '' || host === entry.url) continue
    const fallback = await sqliteJson(join(dir, 'Favicons'),
      `select hex(f.image_data) as hex from icon_mapping m
         join favicon_bitmaps f on f.icon_id = m.icon_id
         where m.page_url like '%//${escaped(host)}/%' and length(f.image_data) > 0
         order by f.width desc limit 1`)
    const hex = Array.isArray(fallback) && fallback[0]?.hex ? String(fallback[0].hex) : ''
    if (hex === '' || hex === 'null') continue
    const bytes = Buffer.from(hex, 'hex')
    if (bytes.length === 0 || bytes.length > 96 * 1024) continue
    icons.set(entry.url, `data:image/png;base64,${bytes.toString('base64')}`)
  }
  return icons
}

async function collectBrowser(limit) {
  const found = await chromeProfileDir()
  if (found === null) return { source: null, visited: [], bookmarks: [] }
  const { profile, dir } = found
  const bookmarks = await readBookmarks(dir)

  const rows = await sqliteJson(join(dir, 'History'),
    `select url, title, visit_count as visitCount, last_visit_time as lastVisit from urls order by visit_count desc limit 400`)
  const visited = []
  const seenHosts = new Set()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const url = String(row.url ?? '')
      if (url === '' || isJunk(url)) continue
      // One entry per site: x.com/twitter.com/… would otherwise eat half the row.
      const host = hostOfUrl(url)
      if (seenHosts.has(host)) continue
      seenHosts.add(host)
      visited.push({
        title: String(row.title ?? '').trim() === '' ? url : String(row.title).trim(),
        url,
        visitCount: Number(row.visitCount ?? 0),
        lastVisit: chromeTime(row.lastVisit),
      })
      if (visited.length >= limit) break
    }
  }

  // Favicons are an optional nicety — never let a failure break the list.
  const icons = await readFavicons(dir, visited)
  for (const entry of visited) {
    const icon = icons.get(entry.url)
    if (icon !== undefined) entry.icon = icon
  }

  return { source: `chrome:${profile}`, visited, bookmarks: [...bookmarks.bar, ...bookmarks.other] }
}

// ── usage widgets ─────────────────────────────────────────────────────────────
//
// Each homepage widget is normalised here so the browser half only ever renders
// { primary, secondary, detail, tone }. A provider adapter can either hit the vendor's
// own balance/quota endpoint or fall back to the token telemetry DSH already keeps per
// session (storages/session_projcache). The fallback works for every provider — known
// or future — because it reads local files only.

const WIDGET_MAX = 4
const USAGE_TTL = 60 * 1000
const DAY_MS = 86_400_000
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROJ_CACHE_DIR = join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const CREDENTIALS_FILE = join(DSH_HOME, '.credentials.yaml')

const PROVIDER_DEFS = {
  deepseek: {
    label: 'DeepSeek',
    keyNames: ['DEEPSEEK_API_KEY'],
    dshProviders: ['deepseek-official', 'deepseek-account', 'deepseek-api-key', 'deepseek'],
    remote: deepseekBalance,
  },
  minimax: {
    label: 'MiniMax',
    keyNames: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
    dshProviders: ['minimax-cn', 'minimax'],
    remote: minimaxQuota,
  },
  'cline-pass': {
    label: 'Cline Pass',
    keyNames: ['CLINE_PASS_API_KEY', 'CLINE_API_KEY'],
    dshProviders: ['cline-pass'],
    remote: clinePassUsage,
  },
  'opencode-go': {
    label: 'OpenCode Go',
    keyNames: ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
    dshProviders: ['opencode-go', 'opencode'],
    remote: opencodeGoUsage,
  },
  tuzi: { label: 'Tuzi', keyNames: ['TUZI_API_KEY'], dshProviders: ['tuzi'] },
}

function num(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function compactTokens(value) {
  const n = Math.round(Number(value) || 0)
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', EUR: '€' }

function money(value, currency) {
  const amount = Number(value)
  const symbol = CURRENCY_SYMBOL[String(currency ?? 'CNY').toUpperCase()] ?? ''
  if (!Number.isFinite(amount)) return `${symbol}—`
  const decimals = Math.abs(amount) >= 1000 ? 0 : 2
  return `${symbol}${amount.toFixed(decimals)}`
}

async function fetchJson(url, init, timeoutMs) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs ?? 5000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}${text === '' ? '' : `: ${text.slice(0, 120)}`}`)
  try {
    return text === '' ? null : JSON.parse(text)
  } catch {
    throw new Error(`响应不是 JSON（${text.slice(0, 80)}）`)
  }
}

// ── credentials ───────────────────────────────────────────────────────────────

let credentialCache = { at: 0, map: null }
const CREDENTIAL_TTL = 30 * 1000

/** Minimal reader for the `refs:` block of $DSH_HOME/.credentials.yaml (NAME: value). */
async function credentialMap() {
  if (credentialCache.map !== null && Date.now() - credentialCache.at < CREDENTIAL_TTL) return credentialCache.map
  const map = {}
  try {
    const text = await readFile(CREDENTIALS_FILE, 'utf8')
    let inRefs = false
    for (const line of text.split('\n')) {
      if (/^refs:\s*$/.test(line)) {
        inRefs = true
        continue
      }
      if (/^\S/.test(line)) {
        inRefs = false
        continue
      }
      if (!inRefs) continue
      const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.+?)\s*$/.exec(line)
      if (match === null) continue
      map[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {}
  credentialCache = { at: Date.now(), map }
  return map
}

function derefCredential(value) {
  const text = String(value ?? '').trim()
  if (text === '') return null
  const envRef = /^\$(?:\{)?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(text) || /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(text)
  if (envRef !== null) return process.env[envRef[1]] ?? null
  return text
}

/**
 * Resolve a provider key without ever returning it to the browser: the credentials
 * service when the composition exposes one, then the local credentials file, then env.
 */
async function resolveKey(scope, names) {
  const credentials = scope !== null && typeof scope?.get === 'function' ? scope.get('credentials') : null
  if (credentials !== null && typeof credentials?.resolve === 'function') {
    for (const name of names) {
      try {
        const hit = await credentials.resolve(name)
        if (hit !== null && typeof hit?.value === 'string' && hit.value.trim() !== '') return hit.value.trim()
      } catch {}
    }
  }
  const map = await credentialMap()
  for (const name of names) {
    const stored = derefCredential(map[name])
    if (stored !== null && stored.trim() !== '') return stored.trim()
    const fromEnv = process.env[name]
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  }
  return null
}

// ── remote adapters ───────────────────────────────────────────────────────────

async function deepseekBalance(options) {
  const key = await resolveKey(options.scope, PROVIDER_DEFS.deepseek.keyNames)
  if (key === null) return null
  const payload = await fetchJson('https://api.deepseek.com/user/balance', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  }, 8000)
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  const info = infos.find((row) => row?.currency === 'CNY') ?? infos.find((row) => row?.currency === 'USD') ?? infos[0]
  if (info === undefined || info === null) throw new Error('余额接口没有返回币种')
  const total = Number(info.total_balance)
  if (!Number.isFinite(total)) throw new Error('余额接口返回了非法数字')
  return {
    kind: 'balance',
    primary: money(total, info.currency),
    secondary: '余额',
    detail: `充值 ${money(info.topped_up_balance, info.currency)} · 赠送 ${money(info.granted_balance, info.currency)}`,
    tone: total <= 10 ? 'warn' : 'ok',
  }
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000))
  if (!Number.isFinite(seconds)) return '—'
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)} 天 ${Math.floor((seconds % 86_400) / 3600)} 小时`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分`
  return `${seconds} 秒`
}

// ── quota cards ───────────────────────────────────────────────────────────────
//
// Every subscription quota the homepage can show (MiniMax coding plan, Cline Pass,
// OpenCode Go) is rendered through this one shape, so the three cards read the same way:
// the 5-hour window is the headline, the weekly and monthly windows ride in the detail
// line in that order, and every number is the share *used*. Vendors disagree on the
// direction (MiniMax reports what is left), so each adapter flips its own numbers before
// they reach here.

const QUOTA_WINDOW_ORDER = ['rolling', 'weekly', 'monthly']
const QUOTA_WINDOW_LABEL = { rolling: '5 小时', weekly: '本周', monthly: '本月' }

/** One window of a quota card. `used` is a 0–100 percentage, never a remainder. */
function quotaWindow(type, options = {}) {
  // `Number(null)` is 0, so only a real number may pass — a missing reading is "—".
  const used = typeof options.used === 'number' ? options.used : NaN
  return {
    type,
    label: QUOTA_WINDOW_LABEL[type] ?? type,
    used: Number.isFinite(used) ? Math.min(100, Math.max(0, Math.round(used))) : null,
    unlimited: options.unlimited === true,
    limited: options.limited === true,
    resetAt: Number.isFinite(options.resetAt) ? options.resetAt : 0,
  }
}

/**
 * The one card shape for a subscription quota. The 5-hour window is always the headline
 * (and the fallback when a vendor omits it); weekly and monthly follow in the detail line.
 * The colour tracks the *worst* window rather than the headline — a monthly window at 95%
 * is what will actually stop a request even while the 5-hour window is empty. Red is
 * reserved for the vendor's own "limited" verdict.
 */
function quotaCard(windows, options = {}) {
  const rows = windows.filter((window) => window !== null && window !== undefined)
  if (rows.length === 0) return null
  const now = Date.now()
  const resetIn = (window) => (window.resetAt > now ? `${formatDuration(window.resetAt - now)}后重置` : '')
  const value = (window) => (window.unlimited ? '不限' : window.used === null ? '—' : `${window.used}%`)
  const ordered = [
    ...QUOTA_WINDOW_ORDER.map((type) => rows.find((window) => window.type === type)).filter((window) => window !== undefined),
    ...rows.filter((window) => QUOTA_WINDOW_ORDER.includes(window.type) === false),
  ]
  const big = ordered[0]
  const small = ordered.slice(1)
  const blocked = ordered.some((window) => window.limited === true)
  const peak = ordered.reduce((max, window) => (window.unlimited ? max : Math.max(max, window.used ?? 0)), 0)
  return {
    kind: 'quota',
    primary: value(big),
    secondary: big.unlimited ? '' : `${big.label}已用`,
    detail: small.length > 0
      ? small.map((window) => (window.unlimited ? `${window.label}不限` : `${window.label} ${value(window)}`)).join(' · ')
      : resetIn(big),
    breakdown: [
      ordered.map((window) => `${window.label}${window.unlimited ? '不限' : `已用 ${value(window)}`}${resetIn(window) === '' ? '' : ` · ${resetIn(window)}`}`).join('；'),
      options.note ?? '',
      options.localNote ?? '',
    ].filter((line) => line !== '').join(' · '),
    tone: blocked ? 'error' : peak >= 80 ? 'warn' : 'ok',
  }
}

/**
 * MiniMax CN coding-plan quota. `sk-cp-` keys answer this route without a GroupId —
 * sending one (even `0`) fails with base_resp 1004. A bad key still returns HTTP 200,
 * so the gate is base_resp.status_code, never the HTTP status. The payload reports what
 * is *left* for both windows, so both are flipped to used percentages here.
 */
async function minimaxQuota(options) {
  const key = await resolveKey(options.scope, PROVIDER_DEFS.minimax.keyNames)
  if (key === null) return null
  const payload = await fetchJson('https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  }, 8000)
  const status = payload?.base_resp?.status_code
  if (status !== 0) throw new Error(`MiniMax ${status ?? '未知'}：${payload?.base_resp?.status_msg ?? '配额接口拒绝'}`)
  const rows = Array.isArray(payload?.model_remains) ? payload.model_remains : []
  const row = rows.find((entry) => entry?.model_name === 'general') ?? rows[0]
  if (row === undefined || row === null) throw new Error('MiniMax 配额接口没有返回额度')
  const now = Date.now()
  const used = (remaining) => {
    const left = Number(remaining)
    return Number.isFinite(left) ? 100 - left : NaN
  }
  const resetAt = (endTime, remainsTime) => {
    const end = num(endTime)
    return end > now ? end : now + num(remainsTime)
  }
  // `*_status: 3` means "no cap" for that window — render it as unlimited, not 0% used.
  const card = quotaCard([
    quotaWindow('rolling', {
      used: used(row.current_interval_remaining_percent),
      unlimited: row.current_interval_status === 3,
      resetAt: resetAt(row.end_time, row.remains_time),
    }),
    quotaWindow('weekly', {
      used: used(row.current_weekly_remaining_percent),
      unlimited: row.current_weekly_status === 3,
      resetAt: resetAt(row.weekly_end_time, row.weekly_remains_time),
    }),
  ])
  if (card === null) throw new Error('MiniMax 配额接口没有返回窗口')
  return card
}

// ── cline pass ────────────────────────────────────────────────────────────────
//
// Cline Pass does not document a usage endpoint, but its clients call this one: three
// rolling windows (5 h / weekly / monthly) as *used* percentages plus reset instants.
// A plain `Bearer <api key>` is accepted; WorkOS OAuth access tokens are not, and those
// have to go through the `workos:` prefix Cline's own desktop app uses. Only retry with
// the prefix when the first call was rejected and the key looks like a JWT, so an
// ordinary bad API key still surfaces as an error instead of being retried twice.

const CLINE_USAGE_URL = 'https://api.cline.bot/api/v1/users/me/plan/usage-limits'
const CLINE_WINDOW_TYPE = { five_hour: 'rolling', weekly: 'weekly', monthly: 'monthly' }

async function clineUsageLimits(key) {
  const call = async (token) => {
    const response = await fetch(CLINE_USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    const text = await response.text()
    if (response.status === 401 || response.status === 403) return { rejected: true, status: response.status }
    if (!response.ok) throw new Error(`HTTP ${response.status}${text === '' ? '' : `: ${text.slice(0, 120)}`}`)
    try {
      return { payload: text === '' ? null : JSON.parse(text) }
    } catch {
      throw new Error(`Cline Pass 用量接口返回的不是 JSON（${text.slice(0, 80)}）`)
    }
  }
  let result = await call(key)
  // `eyJ…` is a base64 JWT header — i.e. an OAuth access token, not an API key.
  if (result.rejected === true && /^ey[A-Za-z0-9_-]+\./.test(key)) result = await call(`workos:${key}`)
  if (result.rejected === true) throw new Error(`Cline Pass 拒绝了这个 key（HTTP ${result.status}）`)
  return result.payload
}

function clineWindow(limit) {
  if (limit === null || typeof limit !== 'object') return null
  const type = CLINE_WINDOW_TYPE[String(limit.type ?? '')]
  if (type === undefined) return null
  const percent = Number(limit.percentUsed)
  if (!Number.isFinite(percent)) return null
  const resetsAt = Date.parse(String(limit.resetsAt ?? ''))
  // Cline already reports *used* percentages, so no flip is needed here.
  return quotaWindow(type, {
    used: percent,
    resetAt: Number.isFinite(resetsAt) ? resetsAt : 0,
  })
}

/**
 * Cline Pass card. The vendor only reports window percentages, so the local session
 * projection supplies the token counts that ride along in the tooltip.
 */
async function clinePassUsage(options) {
  const key = await resolveKey(options.scope, PROVIDER_DEFS['cline-pass'].keyNames)
  if (key === null) return null
  const payload = await clineUsageLimits(key)
  const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : []
  const windows = limits.map(clineWindow).filter((window) => window !== null)
  if (windows.length === 0) throw new Error('Cline Pass 用量接口没有返回窗口')
  let localNote = ''
  try {
    const local = await localUsageFor(PROVIDER_DEFS['cline-pass'].dshProviders)
    if (local !== null) localNote = `${local.primary} tokens（${local.detail}）`
  } catch {}
  const card = quotaCard(windows, { localNote })
  if (card === null) throw new Error('Cline Pass 用量接口没有返回窗口')
  return card
}

// ── opencode go ───────────────────────────────────────────────────────────────
//
// OpenCode Go answers its allowance on the inference gateway itself
// (`/inference/go/v1/usage` — in the gateway OpenAPI, not in the prose docs), so a
// single `OPENCODE_GO_API_KEY` is enough: no Console session, no local OpenCode server.
// The body is the Console's `UsageLimits.Go` — three meters (rolling = the 5-hour
// window, weekly, monthly) whose `percent` is the share of the window *used* (integer
// 0–100, no "remaining" field) and whose `status` is `ok | rate-limited`. The plan's
// documented allowances are 5 h = 20% of the monthly limit, weekly = 50% and monthly =
// 100%, so the tightest window is the one that will block a request first.
// The route is GET-only, `cache-control: no-store`, with no rate-limit headers; the
// vendor's own client allows 15 s per read and re-polls once a minute.

const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/inference/go/v1/usage'
const OPENCODE_GO_WINDOWS = ['rolling', 'weekly', 'monthly']

function opencodeGoMeter(type, entry) {
  if (entry === null || typeof entry !== 'object') return null
  const percent = Number(entry.percent)
  if (!Number.isFinite(percent)) return null
  const resetsAt = Date.parse(String(entry.resetsAt ?? ''))
  // The gateway documents exactly `ok | rate-limited`; any other non-empty status is
  // treated as limited too, so a future value fails safe instead of showing a green card.
  const status = typeof entry.status === 'string' ? entry.status : ''
  const limited = entry.limited === true || (status !== '' && status !== 'ok')
  return quotaWindow(type, {
    // `percent` is already the used share; a rate-limited window is exhausted by
    // definition, so it reads 100% even if the gateway stopped counting early.
    used: limited ? 100 : percent,
    limited,
    resetAt: Number.isFinite(resetsAt) ? resetsAt : 0,
  })
}

async function opencodeGoUsage(options) {
  const key = await resolveKey(options.scope, PROVIDER_DEFS['opencode-go'].keyNames)
  if (key === null) return null
  let payload
  try {
    payload = await fetchJson(OPENCODE_GO_USAGE_URL, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    }, 15_000)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 403 is the gateway's "this workspace has no Go subscription", the usual reason the
    // card cannot render, so name it instead of surfacing a bare HTTP code.
    if (/^HTTP 403\b/.test(message)) throw new Error('这个 key 没有 Go 订阅（HTTP 403）')
    if (/^HTTP 401\b/.test(message)) throw new Error('OpenCode Go 拒绝了这个 key（HTTP 401）')
    throw error
  }
  const usage = payload?.usage ?? payload
  const windows = OPENCODE_GO_WINDOWS
    .map((type) => opencodeGoMeter(type, usage?.[type]))
    .filter((window) => window !== null)
  if (windows.length === 0) throw new Error('OpenCode Go 用量接口没有返回窗口')
  // Same shape as the Cline Pass card: the vendor only reports window percentages, so the
  // local session projection supplies the token counts that ride along in the tooltip.
  let localNote = ''
  try {
    const local = await localUsageFor(PROVIDER_DEFS['opencode-go'].dshProviders)
    if (local !== null) localNote = `${local.primary} tokens（${local.detail}）`
  } catch {}
  const blocked = windows.some((window) => window.limited === true)
  const card = quotaCard(windows, {
    localNote,
    note: blocked ? '额度已到顶，可等重置或在 Console 的 Go 页开启 Extra Usage 走余额' : '',
  })
  if (card === null) throw new Error('OpenCode Go 用量接口没有返回窗口')
  return card
}

// ── local token telemetry ─────────────────────────────────────────────────────

let localUsageCache = { at: 0, value: null }

/**
 * Fold every cached session projection into per-DSH-provider token totals. The cache is
 * ~500 small JSON files (~9 MB); parsing it once a minute is cheaper than one HTTP call.
 */
async function scanLocalUsage() {
  if (localUsageCache.value !== null && Date.now() - localUsageCache.at < USAGE_TTL) return localUsageCache.value
  const byProvider = new Map()
  let entries = []
  try {
    entries = await readdir(PROJ_CACHE_DIR, { withFileTypes: true })
  } catch {
    localUsageCache = { at: Date.now(), value: byProvider }
    return byProvider
  }
  const now = Date.now()
  for (const entry of entries) {
    if (entry.isFile() !== true || entry.name.endsWith('.json') !== true) continue
    let text
    try {
      text = await readFile(join(PROJ_CACHE_DIR, entry.name), 'utf8')
    } catch {
      continue
    }
    let rows
    try {
      rows = JSON.parse(text)?.record?.rows
    } catch {
      continue
    }
    if (rows === null || typeof rows !== 'object') continue
    const provider = rows.modelSelection?.val?.lastUsed?.provider
    if (typeof provider !== 'string' || provider === '') continue
    const totals = rows.tokenUsage?.val?.totals
    if (totals === null || typeof totals !== 'object') continue
    const lastAt = num(rows.timeContext?.val?.lastMessageTime) || num(rows.sessionListMetadata?.val?.lastPromptAt)
    const input = num(totals.uncachedInputTokens) + num(totals.cacheWriteTokens)
    const cacheRead = num(totals.cacheReadTokens)
    const output = num(totals.outputTokens)
    if (input + output + cacheRead === 0) continue
    const current = byProvider.get(provider) ?? { input: 0, output: 0, cacheRead: 0, sessions: 0, lastAt: 0, recent: 0 }
    current.input += input
    current.output += output
    current.cacheRead += cacheRead
    current.sessions += 1
    current.lastAt = Math.max(current.lastAt, lastAt)
    if (lastAt > 0 && now - lastAt < 7 * DAY_MS) current.recent += 1
    byProvider.set(provider, current)
  }
  localUsageCache = { at: Date.now(), value: byProvider }
  return byProvider
}

/** Token totals for the local sessions of one provider family, or null when unknown. */
async function localUsageFor(dshProviders) {
  const wanted = new Set(dshProviders)
  const byProvider = await scanLocalUsage()
  let input = 0
  let output = 0
  let cacheRead = 0
  let sessions = 0
  let recent = 0
  for (const [id, aggregate] of byProvider) {
    if (wanted.has(id) !== true) continue
    input += aggregate.input
    output += aggregate.output
    cacheRead += aggregate.cacheRead
    sessions += aggregate.sessions
    recent += aggregate.recent
  }
  if (sessions === 0) return null
  return {
    kind: 'tokens',
    primary: compactTokens(input + output),
    secondary: 'tokens',
    detail: `本机 ${sessions} 个会话${recent > 0 ? ` · 7 天内 ${recent} 个活跃` : ''}`,
    breakdown: `输入 ${compactTokens(input)} · 输出 ${compactTokens(output)}${cacheRead > 0 ? ` · 缓存命中 ${compactTokens(cacheRead)}` : ''}`,
    tone: 'neutral',
  }
}

// ── widget assembly ───────────────────────────────────────────────────────────

const usageCache = new Map()
const usageInflight = new Map()

function sanitizeWidgetItems(config) {
  const items = Array.isArray(config?.widgets?.items) ? config.widgets.items : []
  const kept = []
  for (const item of items) {
    if (kept.length >= WIDGET_MAX) break
    if (item === null || typeof item !== 'object') continue
    if (typeof item.provider !== 'string' || item.provider.trim() === '') continue
    if (item.type !== undefined && item.type !== 'usage') continue
    kept.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : `w-${kept.length + 1}`,
      type: 'usage',
      provider: item.provider.trim().toLowerCase(),
    })
  }
  return kept
}

function errorWidget(item, message) {
  return {
    id: item.id,
    type: 'usage',
    provider: item.provider,
    label: PROVIDER_DEFS[item.provider]?.label ?? item.provider,
    kind: 'error',
    primary: '—',
    secondary: '',
    detail: message === '' ? '暂无可用数据' : `获取失败：${message.slice(0, 70)}`,
    tone: 'error',
    stale: false,
    error: message,
  }
}

async function computeUsageWidget(item, options) {
  const def = PROVIDER_DEFS[item.provider] ?? {
    label: item.provider,
    keyNames: [],
    dshProviders: [item.provider],
  }
  const errors = []
  if (typeof def.remote === 'function') {
    try {
      const remote = await def.remote(options)
      if (remote !== null && remote !== undefined) {
        return {
          id: item.id,
          type: 'usage',
          provider: item.provider,
          label: def.label,
          kind: remote.kind ?? 'balance',
          primary: remote.primary ?? '—',
          secondary: remote.secondary ?? '',
          detail: remote.detail ?? '',
          breakdown: remote.breakdown ?? '',
          tone: remote.tone ?? 'ok',
          stale: false,
          error: null,
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  try {
    const local = await localUsageFor(def.dshProviders)
    if (local !== null) {
      return {
        id: item.id,
        type: 'usage',
        provider: item.provider,
        label: def.label,
        ...local,
        stale: false,
        error: errors.length > 0 ? errors[0] : null,
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return errorWidget(item, errors.join('；'))
}

async function usageWidget(item, options) {
  const key = `${item.provider}|${item.type}`
  const cached = usageCache.get(key)
  if (options.fresh !== true && cached !== undefined && Date.now() - cached.at < USAGE_TTL) return cached.widget
  if (options.fresh !== true && usageInflight.has(key)) return usageInflight.get(key)
  const task = (async () => {
    try {
      const widget = await computeUsageWidget(item, options)
      usageCache.set(key, { at: Date.now(), widget })
      return widget
    } catch (error) {
      if (cached !== undefined) return { ...cached.widget, stale: true }
      return errorWidget(item, error instanceof Error ? error.message : String(error))
    }
  })()
  usageInflight.set(key, task)
  try {
    return await task
  } finally {
    usageInflight.delete(key)
  }
}

async function usagePayload(config, options) {
  const items = sanitizeWidgetItems(config)
  // Providers are independent HTTP calls; fan out so one slow vendor does not queue
  // every other card behind it.
  const widgets = await Promise.all(items.map((item) => usageWidget(item, options)))
  return { fetchedAt: Date.now(), widgets }
}

// ── plugin body ───────────────────────────────────────────────────────────────

async function statePayload() {
  const config = await readConfig()
  return {
    config,
    assets: {
      background: (await assetPath('background', config.background.asset)) !== null,
      logo: (await assetPath('logo', config.logo.asset)) !== null,
    },
  }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.webServer

    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = `${req.method} ${url.pathname.replace(API, '') || '/'}`
      const mutation = req.method !== 'GET' && req.method !== 'HEAD'

      if (!trusted(req, { mutation })) {
        send(res, 403, { error: 'forbidden' })
        return
      }

      try {
        if (route === 'GET /state') {
          send(res, 200, await statePayload())
          return
        }

        if (route === 'POST /config') {
          const patch = JSON.parse((await readBody(req)).toString('utf8') || '{}')
          const next = merge(await readConfig(), patch)
          // The row is capped at four cards; enforce it server-side so a hand-edited
          // config file cannot overflow the homepage layout either.
          if (next.widgets !== null && typeof next.widgets === 'object') {
            next.widgets.items = sanitizeWidgetItems(next)
          }
          await writeConfig(next)
          send(res, 200, await statePayload())
          return
        }

        if (route === 'GET /usage') {
          const config = await readConfig()
          const fresh = url.searchParams.get('refresh') === '1'
          send(res, 200, await usagePayload(config, { fresh, scope }))
          return
        }

        if (route === 'POST /asset') {
          const kind = url.searchParams.get('kind')
          if (kind !== 'background' && kind !== 'logo') {
            send(res, 400, { error: 'kind must be background|logo' })
            return
          }
          const body = await readBody(req)
          if (body.length === 0) {
            send(res, 400, { error: 'empty body' })
            return
          }
          const asset = await saveAsset(kind, body, req.headers['content-type'])
          const config = await readConfig()
          if (kind === 'background') config.background.asset = asset
          else config.logo.asset = asset
          await writeConfig(config)
          send(res, 200, await statePayload())
          return
        }

        if (route === 'POST /asset/clear') {
          const kind = url.searchParams.get('kind')
          const config = await readConfig()
          if (kind === 'background') config.background.asset = null
          else if (kind === 'logo') config.logo.asset = null
          else {
            send(res, 400, { error: 'kind must be background|logo' })
            return
          }
          await dropAsset(kind)
          await writeConfig(config)
          send(res, 200, await statePayload())
          return
        }

        if (route === 'GET /asset') {
          const kind = url.searchParams.get('kind')
          const config = await readConfig()
          const asset = kind === 'logo' ? config.logo.asset : config.background.asset
          const found = await assetPath(kind === 'logo' ? 'logo' : 'background', asset)
          if (found === null) {
            send(res, 404, { error: 'not found' })
            return
          }
          const etag = `"${found.mtimeMs}-${found.size}"`
          if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, { etag, 'cache-control': 'no-cache' })
            res.end()
            return
          }
          const bytes = await readFile(found.file)
          res.writeHead(200, {
            'content-type': EXT_MIME[String(asset.ext)] ?? 'application/octet-stream',
            'cache-control': 'no-cache',
            etag,
            'content-length': bytes.length,
          })
          res.end(bytes)
          return
        }

        if (route === 'GET /browser') {
          const fresh = url.searchParams.get('refresh') === '1'
          if (fresh || browserCache.value === null || Date.now() - browserCache.at > BROWSER_TTL) {
            const config = await readConfig()
            browserCache = { at: Date.now(), value: await collectBrowser(Math.max(4, Number(config.links.autoCount) || 8)) }
          }
          send(res, 200, browserCache.value)
          return
        }

        send(res, 404, { error: 'unknown route', route })
      } catch (error) {
        send(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    }

    scope.effect(() => webServer.register({ kind: 'prefix', path: API, handler }), 'dsh-my-newhome: http api')
  })
}

/**
 * Test-only surface: the host half otherwise exposes just `name`/`apply`. Kept tiny so
 * the smoke test can exercise the pure helpers and fake a provider without networking.
 */
export const internals = {
  PROVIDER_DEFS,
  applyMigrations,
  sanitizeWidgetItems,
  compactTokens,
  money,
  computeUsageWidget,
  localUsageFor,
  scanLocalUsage,
  derefCredential,
  formatDuration,
  opencodeGoMeter,
  quotaWindow,
  quotaCard,
}
