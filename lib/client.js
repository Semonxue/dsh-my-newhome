/* dsh-my-newhome — browser half.
 *
 * One Cordis client plugin that owns the whole "custom homepage" surface:
 *   theme tokens · background layer · hero/sidebar logo · active-workspace cards
 *   · browser/custom quick links · its own settings dialog.
 *
 * It talks to its own host route (/dsh-my-newhome) for config + image bytes; it never
 * touches the harness settings documents.
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-newhome',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    const PKG = 'dsh-my-newhome'
    const API = '/dsh-my-newhome'
    const PLUGIN_CSS = `${PKG}/homepage.css`

    // ── xhr ───────────────────────────────────────────────────────────────────
    async function api(path, init) {
      const request = { ...init, headers: { 'x-dsh-my-newhome': '1', ...(init && init.headers) } }
      const response = await fetch(`${API}${path}`, request)
      if (!response.ok) throw new Error(`${path} → ${response.status}`)
      return response.json()
    }

    async function uploadAsset(kind, file) {
      const response = await fetch(`${API}/asset?kind=${kind}`, {
        method: 'POST',
        headers: { 'x-dsh-my-newhome': '1', 'content-type': file.type || 'image/png' },
        body: file,
      })
      if (!response.ok) throw new Error(`upload ${kind} → ${response.status}`)
      return response.json()
    }

    // ── store ─────────────────────────────────────────────────────────────────
    const DEFAULT_STATE = {
      config: {
        theme: { mode: 'follow', accent: '#4f7cff', surfaceDark: '#0a0c10', surfaceLight: '#f6f7fb' },
        background: { enabled: false, fit: 'cover', opacity: 1, blur: 0, dim: 0.28, asset: null },
        logo: { asset: null, hideHeroTagline: false, wordmark: '' },
        workspaces: { enabled: true, count: 6, strategy: 'recent', halfLifeDays: 14, place: 'above', onlyOnHero: true },
        links: { auto: true, autoCount: 6, place: 'below', items: [] },
        widgets: { enabled: true, refreshMinutes: 5, items: [] },
      },
      assets: { background: false, logo: false },
      session: { id: null, blank: true },
    }

    const listeners = new Set()
    let snapshot = DEFAULT_STATE
    let browserEntries = null
    // Usage widgets: the host normalises every provider into one payload shape, so the
    // browser half never needs to know which API a card was built from.
    let usageData = null // { fetchedAt, widgets: [...] }
    let usageBusy = false
    let usageError = ''
    let usageStaleAt = 0
    const USAGE_MIN_GAP = 30_000
    let react = () => {} // assigned by apply(): re-applies theme/background/logo
    let pluginCtx = null

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function publish(next) {
      snapshot = next
      for (const listener of [...listeners]) listener()
      react()
    }

    function useHomepage() {
      const [, bump] = React.useReducer((value) => value + 1, 0)
      useEffect(() => subscribe(bump), [])
      return snapshot
    }

    function readSession() {
      try {
        const store = pluginCtx !== null ? pluginCtx.get('sessions') : null
        const list = store && store.list
        const data = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : null
        if (!data) return { id: null, blank: true }
        const id = data.current !== undefined ? data.current : null
        const summary = id !== null && data.byId ? data.byId[id] : null
        return { id, blank: summary ? summary.blank === true : true }
      } catch (error) {
        return { id: null, blank: true }
      }
    }

    /** Session switches are frequent and must never re-run theme/logo work. */
    function publishSession(next) {
      if (snapshot.session && snapshot.session.id === next.id && snapshot.session.blank === next.blank) return
      snapshot = { ...snapshot, session: next }
      for (const listener of [...listeners]) listener()
    }

    async function refresh() {
      const next = await api('/state')
      publish({ ...next, session: readSession() })
      return next
    }

    async function patchConfig(patch) {
      const next = await api('/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      publish(next)
      return next
    }

    /** Cheap repaint for data that is not part of the config (never re-themes the page). */
    function notify() {
      for (const listener of [...listeners]) listener()
    }

    /**
     * One shared fetch for the whole widget row: the host already fans out per provider
     * and caches, so polling here stays a single request no matter how many cards show.
     */
    async function loadUsage(force) {
      if (usageBusy) return usageData
      if (force !== true && usageData !== null && Date.now() - usageStaleAt < USAGE_MIN_GAP) return usageData
      usageBusy = true
      // A manual refresh dims the cards immediately; the 5-minute poll stays silent.
      if (force === true) notify()
      try {
        usageData = await api(`/usage${force === true ? '?refresh=1' : ''}`)
        usageStaleAt = Date.now()
        usageError = ''
      } catch (error) {
        usageError = error instanceof Error ? error.message : String(error)
      } finally {
        usageBusy = false
        notify()
      }
      return usageData
    }

    // ── theme ─────────────────────────────────────────────────────────────────
    const TOKENS = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-layer-3',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--dsw-alias-border-l1',
      '--dsw-alias-border-l2',
      '--dsw-alias-border-l3',
      '--dsw-alias-brand-primary',
      '--dsw-alias-button-primary-fill',
      '--dsw-alias-button-primary-hover',
      '--dsw-alias-state-business-primary',
      '--dsw-alias-interactive-bg-hover',
      '--dsw-alias-settings-card-fill',
    ]

    function hexToRgb(hex) {
      const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
      if (match === null) return null
      const n = Number.parseInt(match[1], 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }

    function mix(hex, target, amount) {
      const rgb = hexToRgb(hex)
      if (rgb === null) return null
      const t = target
      return `rgb(${rgb.map((c, i) => Math.round(c * (1 - amount) + t[i] * amount)).join(', ')})`
    }

    const WHITE = [255, 255, 255]
    const BLACK = [0, 0, 0]

    /** Curated palette: only tokens that carry the page chrome, kept per colour scheme. */
    function themeTokens(config) {
      const accent = config.accent || '#4f7cff'
      const dark = config.surfaceDark || '#0a0c10'
      const light = config.surfaceLight || '#f6f7fb'
      if (config.mode !== 'custom') {
        return {
          '--dsw-alias-brand-primary': { light: accent, dark: accent },
          '--dsw-alias-button-primary-fill': { light: accent, dark: accent },
          '--dsw-alias-state-business-primary': { light: accent, dark: accent },
        }
      }
      const darkLayer = (amount) => mix(dark, WHITE, amount) || dark
      const lightLayer = (amount) => mix(light, WHITE, amount) || light
      return {
        '--dsw-alias-bg-base': { light, dark },
        '--dsw-alias-bg-layer-1': { light: lightLayer(0.03), dark: darkLayer(0.05) },
        '--dsw-alias-bg-layer-2': { light: lightLayer(0.06), dark: darkLayer(0.09) },
        '--dsw-alias-bg-layer-3': { light: lightLayer(0.09), dark: darkLayer(0.13) },
        '--dsw-alias-label-primary': { light: mix(light, BLACK, 0.9) || '#14161a', dark: mix(dark, WHITE, 0.94) || '#eef1f6' },
        '--dsw-alias-label-secondary': { light: mix(light, BLACK, 0.66) || '#4a4f59', dark: mix(dark, WHITE, 0.68) || '#a8afbb' },
        '--dsw-alias-label-tertiary': { light: mix(light, BLACK, 0.46) || '#767c88', dark: mix(dark, WHITE, 0.46) || '#767e8c' },
        '--dsw-alias-border-l1': { light: mix(light, BLACK, 0.08) || '#e6e8ee', dark: mix(dark, WHITE, 0.1) || '#1d2128' },
        '--dsw-alias-border-l2': { light: mix(light, BLACK, 0.14) || '#d9dce4', dark: mix(dark, WHITE, 0.16) || '#282d36' },
        '--dsw-alias-border-l3': { light: mix(light, BLACK, 0.2) || '#c9cdd7', dark: mix(dark, WHITE, 0.22) || '#333a45' },
        '--dsw-alias-brand-primary': { light: accent, dark: accent },
        '--dsw-alias-button-primary-fill': { light: accent, dark: accent },
        '--dsw-alias-button-primary-hover': { light: mix(accent, BLACK, 0.12) || accent, dark: mix(accent, WHITE, 0.12) || accent },
        '--dsw-alias-state-business-primary': { light: accent, dark: accent },
        '--dsw-alias-interactive-bg-hover': { light: mix(light, BLACK, 0.05) || '#eff1f6', dark: mix(dark, WHITE, 0.07) || '#14171d' },
        '--dsw-alias-settings-card-fill': { light: lightLayer(0.02), dark: darkLayer(0.04) },
      }
    }

    // ── background layer ──────────────────────────────────────────────────────
    function applyBackground(current) {
      const config = current.config.background
      const root = document.documentElement
      const existing = document.getElementById('dshh-bg')
      if (!config.enabled || current.assets.background !== true) {
        if (existing !== null) existing.remove()
        root.removeAttribute('data-dshh-bg')
        return
      }
      let layer = existing
      if (layer === null) {
        layer = document.createElement('div')
        layer.id = 'dshh-bg'
        layer.setAttribute('aria-hidden', 'true')
        document.body.prepend(layer)
      }
      const version = config.asset && config.asset.version ? config.asset.version : Date.now()
      layer.style.backgroundImage = `url("${API}/asset?kind=background&v=${version}")`
      layer.style.backgroundSize = config.fit === 'contain' ? 'contain' : config.fit === 'fill' ? 'cover' : (config.fit || 'cover')
      layer.style.backgroundPosition = 'center center'
      layer.style.opacity = String(config.opacity ?? 1)
      layer.style.filter = Number(config.blur) > 0 ? `blur(${Number(config.blur)}px)` : 'none'
      layer.style.setProperty('--dshh-dim', String(config.dim ?? 0.28))
      root.setAttribute('data-dshh-bg', '1')
    }

    // ── ranking ───────────────────────────────────────────────────────────────
    const DAY = 86400000

    function sessionTime(summary) {
      if (summary === null || summary === undefined) return 0
      const projected = summary.projectionValues
      const lastMessage = projected && projected.timeContext && projected.timeContext.lastMessageTime
      if (typeof lastMessage === 'number' && lastMessage > 0) return lastMessage
      return typeof summary.updatedAt === 'number' ? summary.updatedAt : 0
    }

    function sessionTurns(summary) {
      if (summary === null || summary === undefined) return 0
      const stats = summary.projectionValues && summary.projectionValues.sessionStats
      return stats && typeof stats.turns === 'number' ? stats.turns : 0
    }

    /**
     * The deck is titled 最近工作区, so the default ranking is true recency: the workspace
     * whose sessions were touched last wins. `activity` keeps a decay-weighted score for
     * people who want old high-volume projects to stay visible, and `sessions` ranks by
     * project size — both are opt-in in the settings panel, never the default.
     */
    function rankWorkspaces(store, sessions, config) {
      const items = store && Array.isArray(store.items) ? store.items : []
      const byId = sessions && sessions.byId ? sessions.byId : {}
      const archived = new Set((store && store.archivedSessionIds) || [])
      const halfLife = Math.max(1, Number(config.halfLifeDays) || 14) * DAY
      const now = Date.now()
      const rows = []
      for (const workspace of items) {
        let weight = 0
        let turns = 0
        let sessions30 = 0
        let lastActive = 0
        let live = 0
        for (const sessionId of workspace.sessionIds || []) {
          if (archived.has(sessionId)) continue
          const summary = byId[sessionId]
          if (summary === undefined || summary === null) continue
          if (summary.blank === true) continue
          if (summary.origin === 'subagent') continue
          live += 1
          const at = sessionTime(summary)
          if (at > 0) {
            weight += 1 / (1 + (now - at) / halfLife)
            if (now - at < 30 * DAY) sessions30 += 1
          }
          turns += sessionTurns(summary)
          if (summary.running === true) perWorkspaceRunning.add(workspace.workspaceId)
          lastActive = Math.max(lastActive, at)
        }
        // Opening a workspace (attach/rename) also stamps the record, so treat that as
        // light usage and never show a time older than the record itself.
        const recordAt = Date.parse(workspace.updatedAt || '') || 0
        if (recordAt > lastActive) lastActive = recordAt
        if (recordAt > 0) weight += 0.35 / (1 + (now - recordAt) / halfLife)
        const created = Date.parse(workspace.createdAt || '') || 0
        if (lastActive === 0) lastActive = created
        rows.push({
          id: workspace.workspaceId,
          title: workspace.title || workspace.path || 'workspace',
          path: workspace.path,
          sessions: live,
          turns,
          sessions30,
          lastActive,
          score: weight,
        })
      }
      perWorkspaceRunning = new Set()
      const strategy = config.strategy === 'activity' || config.strategy === 'sessions' ? config.strategy : 'recent'
      rows.sort((left, right) => {
        if (strategy === 'activity') {
          return right.score - left.score || right.lastActive - left.lastActive
            || right.sessions30 - left.sessions30 || right.turns - left.turns
        }
        if (strategy === 'sessions') return right.sessions - left.sessions || right.lastActive - left.lastActive
        return right.lastActive - left.lastActive || right.sessions - left.sessions || right.turns - left.turns
      })
      return rows.slice(0, Math.min(8, Math.max(3, Number(config.count) || 6)))
    }

    // ── refresh ───────────────────────────────────────────────────────────────
    // Recency lives in the harness' session list (each row's last-message timestamp), not
    // in the workspace record — that one only moves when a workspace is attached or
    // renamed. `sessions.refresh()` re-pulls the list baseline from the host, so the deck
    // can be re-ranked against reality instead of against whatever this page loaded at boot.
    const WORKSPACE_PULL_GAP = 15_000
    // Returning to the window is the valuable trigger (the app idles for hours), not a
    // minute-by-minute one, so it gets its own, much wider gate on top of the shared one.
    const WORKSPACE_FOCUS_GAP = 60_000
    let workspacePullAt = 0
    let workspacePullInflight = null
    let workspacePullError = ''

    function sessionService() {
      try {
        return pluginCtx !== null && typeof pluginCtx.get === 'function' ? pluginCtx.get('sessions') : null
      } catch {
        return null
      }
    }

    /**
     * Ask the host for a fresh look at every session's activity.
     * @param {{ force?: boolean, sessionIds?: string[] }} options - `force` skips the
     *   throttle (a click), `sessionIds` drives the per-projection fallback for older
     *   harness builds that do not expose the list-wide refresh.
     * @returns the in-flight pull, or null when throttled/unavailable.
     */
    function pullWorkspaceActivity(options) {
      const force = Boolean(options && options.force)
      if (workspacePullInflight !== null) return workspacePullInflight
      if (!force && workspacePullAt > 0 && Date.now() - workspacePullAt < WORKSPACE_PULL_GAP) return null
      const service = sessionService()
      if (service === null) return null
      const run = (async () => {
        try {
          if (typeof service.refresh === 'function') {
            await service.refresh()
          } else {
            const ids = Array.isArray(options && options.sessionIds) ? options.sessionIds.slice(0, 80) : []
            if (ids.length === 0 || typeof service.refreshProjections !== 'function') return
            await Promise.allSettled(ids.map((id) => service.refreshProjections(id)))
          }
          workspacePullError = ''
        } catch (error) {
          workspacePullError = error instanceof Error ? error.message : String(error)
          throw error
        } finally {
          workspacePullAt = Date.now()
          workspacePullInflight = null
        }
      })()
      workspacePullInflight = run
      return run
    }

    let perWorkspaceRunning = new Set()

    function ago(at) {
      if (!at) return ''
      const delta = Date.now() - at
      if (delta < 60_000) return '刚刚'
      if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
      if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
      if (delta < 30 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`
      return `${Math.floor(delta / (30 * 86_400_000))} 个月前`
    }

    function hostOf(url) {
      try {
        return new URL(url).hostname.replace(/^www\./, '')
      } catch {
        return url
      }
    }

    // ── settings dialog ───────────────────────────────────────────────────────
    const OPEN_EVENT = 'dshh:settings'
    let dialogRoot = null

    function openSettings() {
      window.dispatchEvent(new CustomEvent(OPEN_EVENT))
    }

    const FIELD = {
      width: '100%',
      boxSizing: 'border-box',
      background: 'var(--dsw-alias-bg-layer-2, #1a1d23)',
      color: 'var(--dsw-alias-label-primary, #eee)',
      border: '1px solid var(--dsw-alias-border-l2, #333)',
      borderRadius: '8px',
      padding: '7px 10px',
      fontSize: '13px',
      fontFamily: 'inherit',
    }

    function Label({ text, children }) {
      return h('label', { className: 'dshh-field' },
        h('span', { className: 'dshh-field-label' }, text),
        children)
    }

    function Toggle({ checked, onChange, text }) {
      return h('label', { className: 'dshh-toggle' },
        h('input', { type: 'checkbox', checked: checked === true, onChange: (event) => onChange(event.target.checked) }),
        h('span', null, text))
    }

    function SettingsDialog() {
      const current = useHomepage()
      // Older host builds have no `widgets` block; start from a complete draft so the
      // panel never crashes on a missing section.
      const [draft, setDraft] = useState(() => {
        const next = JSON.parse(JSON.stringify(current.config))
        if (next.widgets === null || typeof next.widgets !== 'object') {
          next.widgets = { enabled: true, refreshMinutes: 5, items: [] }
        }
        if (Array.isArray(next.widgets.items) !== true) next.widgets.items = []
        return next
      })
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const fileInput = useRef(null)

      const edit = (path, value) => {
        setDraft((previous) => {
          const next = JSON.parse(JSON.stringify(previous))
          let cursor = next
          for (let index = 0; index < path.length - 1; index += 1) cursor = cursor[path[index]]
          cursor[path[path.length - 1]] = value
          return next
        })
      }

      const save = async () => {
        setBusy(true)
        setNote('')
        try {
          await patchConfig(draft)
          setNote('已保存')
        } catch (error) {
          setNote(`保存失败：${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      const upload = async (kind, file) => {
        if (!file) return
        setBusy(true)
        setNote('')
        try {
          const next = await uploadAsset(kind, file)
          publish(next)
          setNote(kind === 'background' ? '背景已更新' : 'Logo 已更新')
        } catch (error) {
          setNote(`上传失败：${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      const clear = async (kind) => {
        setBusy(true)
        try {
          const next = await api(`/asset/clear?kind=${kind}`, { method: 'POST' })
          publish(next)
          setNote('已移除')
        } catch (error) {
          setNote(`操作失败：${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      const refreshBrowser = async () => {
        setBusy(true)
        try {
          browserEntries = await api('/browser?refresh=1')
          setNote(`已抓取 ${browserEntries.visited.length} 个常用站点`)
        } catch (error) {
          setNote(`抓取失败：${error.message}`)
        } finally {
          setBusy(false)
          publish(snapshot)
        }
      }

      const linksText = JSON.stringify(draft.links.items ?? [], null, 2)
      const [linksDraft, setLinksDraft] = useState(linksText)
      const commitLinks = () => {
        try {
          const parsed = JSON.parse(linksDraft)
          if (!Array.isArray(parsed)) throw new Error('需要数组')
          edit(['links', 'items'], parsed)
          setNote('自定义入口已更新（记得保存）')
        } catch (error) {
          setNote(`入口格式错误：${error.message}`)
        }
      }

      const widgetList = Array.isArray(draft.widgets?.items) ? draft.widgets.items : []
      const usedProviders = new Set(widgetList.map((item) => item && item.provider))
      const addWidget = () => {
        if (widgetList.length >= WIDGET_MAX) return
        const next = WIDGET_PROVIDERS.find((provider) => !usedProviders.has(provider.id)) || WIDGET_PROVIDERS[0]
        edit(['widgets', 'items'], [...widgetList, {
          id: `w-${Date.now().toString(36)}`,
          type: 'usage',
          provider: next.id,
        }])
      }
      const removeWidget = (index) => {
        edit(['widgets', 'items'], widgetList.filter((_, position) => position !== index))
      }
      const patchWidget = (index, patch) => {
        edit(['widgets', 'items'], widgetList.map((item, position) => (position === index ? { ...item, ...patch } : item)))
      }

      return h('div', { className: 'dshh-modal-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) window.dispatchEvent(new CustomEvent('dshh:close')) } },
        h('div', { className: 'dshh-modal' },
          h('header', { className: 'dshh-modal-head' },
            h('strong', null, '自定义主页'),
            h('button', { type: 'button', className: 'dshh-icon-btn', onClick: () => window.dispatchEvent(new CustomEvent('dshh:close')) }, '✕')),
          h('div', { className: 'dshh-modal-body' },

            h('section', { className: 'dshh-section' },
              h('h4', null, '配色'),
              h(Label, { text: '模式' },
                h('select', { style: FIELD, value: draft.theme.mode, onChange: (e) => edit(['theme', 'mode'], e.target.value) },
                  h('option', { value: 'follow' }, '跟随 DSH 的暗 / 亮'),
                  h('option', { value: 'custom' }, '使用下面的自定义配色'))),
              h(Label, { text: '强调色' },
                h('input', { type: 'color', className: 'dshh-color', style: { ...FIELD, height: 34, padding: 2 }, value: draft.theme.accent, onChange: (e) => edit(['theme', 'accent'], e.target.value) })),
              draft.theme.mode === 'custom' ? h('div', { className: 'dshh-duo' },
                h(Label, { text: '深色底色' },
                  h('input', { type: 'color', className: 'dshh-color', style: { ...FIELD, height: 34, padding: 2 }, value: draft.theme.surfaceDark, onChange: (e) => edit(['theme', 'surfaceDark'], e.target.value) })),
                h(Label, { text: '浅色底色' },
                  h('input', { type: 'color', className: 'dshh-color', style: { ...FIELD, height: 34, padding: 2 }, value: draft.theme.surfaceLight, onChange: (e) => edit(['theme', 'surfaceLight'], e.target.value) }))) : null),

            h('section', { className: 'dshh-section' },
              h('h4', null, '背景图'),
              h(Toggle, { checked: draft.background.enabled, onChange: (value) => edit(['background', 'enabled'], value), text: '启用背景图' }),
              h('div', { className: 'dshh-row-inline' },
                h('button', { type: 'button', className: 'dshh-btn', disabled: busy, onClick: () => fileInput.current && fileInput.current.click() }, '选择图片…'),
                h('button', { type: 'button', className: 'dshh-btn', disabled: busy || current.assets.background !== true, onClick: () => clear('background') }, '移除')),
              h('input', { ref: fileInput, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: (event) => upload('background', event.target.files && event.target.files[0]) }),
              h(Label, { text: `不透明度 ${draft.background.opacity}` },
                h('input', { type: 'range', min: 0.2, max: 1, step: 0.02, value: draft.background.opacity, onChange: (e) => edit(['background', 'opacity'], Number(e.target.value)) })),
              h(Label, { text: `模糊 ${Number(draft.background.blur).toFixed(0)}px` },
                h('input', { type: 'range', min: 0, max: 40, step: 1, value: draft.background.blur, onChange: (e) => edit(['background', 'blur'], Number(e.target.value)) })),
              h(Label, { text: `压暗 ${Number(draft.background.dim).toFixed(2)}` },
                h('input', { type: 'range', min: 0, max: 0.85, step: 0.01, value: draft.background.dim, onChange: (e) => edit(['background', 'dim'], Number(e.target.value)) }))),

            h('section', { className: 'dshh-section' },
              h('h4', null, 'Logo'),
              h('div', { className: 'dshh-row-inline' },
                h('button', { type: 'button', className: 'dshh-btn', disabled: busy, onClick: () => { const input = document.getElementById('dshh-logo-input'); if (input) input.click() } }, '上传 Logo…'),
                h('button', { type: 'button', className: 'dshh-btn', disabled: busy || current.assets.logo !== true, onClick: () => clear('logo') }, '移除')),
              h('input', { id: 'dshh-logo-input', type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: (event) => upload('logo', event.target.files && event.target.files[0]) }),
              h('p', { className: 'dshh-hint' }, current.assets.logo === true ? '已设置：首屏鱼形标志与侧栏标志将被替换。' : '未设置：保持 DSH 原始标志。'),
              h(Toggle, { checked: draft.logo.hideHeroTagline, onChange: (value) => edit(['logo', 'hideHeroTagline'], value), text: '同时隐藏首屏标语文字' }),
              h(Label, { text: '侧栏字标（留空则用 Logo 代替）' },
                h('input', { style: FIELD, value: draft.logo.wordmark, placeholder: '例如 My Studio', onChange: (e) => edit(['logo', 'wordmark'], e.target.value) }))),

            h('section', { className: 'dshh-section' },
              h('h4', null, '工作区卡片'),
              h(Toggle, { checked: draft.workspaces.enabled, onChange: (value) => edit(['workspaces', 'enabled'], value), text: '在输入框上方显示' }),
              h(Label, { text: `显示数量：${draft.workspaces.count}` },
                h('input', { type: 'range', min: 3, max: 8, step: 1, value: draft.workspaces.count, onChange: (e) => edit(['workspaces', 'count'], Number(e.target.value)) })),
              h(Label, { text: '排序策略' },
                h('select', { style: FIELD, value: draft.workspaces.strategy, onChange: (e) => edit(['workspaces', 'strategy'], e.target.value) },
                  h('option', { value: 'recent' }, '最近使用（推荐）'),
                  h('option', { value: 'activity' }, '活跃度（半衰期加权）'),
                  h('option', { value: 'sessions' }, '会话数量'))),
              h('p', { className: 'dshh-hint' }, '「最近使用」按每个工作区最后一次对话的时间排序；鼠标悬停标题行的 ↻ 可立刻重新读取。'),
              draft.workspaces.strategy === 'activity' ? h(Label, { text: `半衰期：${draft.workspaces.halfLifeDays} 天` },
                h('input', { type: 'range', min: 3, max: 60, step: 1, value: draft.workspaces.halfLifeDays, onChange: (e) => edit(['workspaces', 'halfLifeDays'], Number(e.target.value)) })) : null),

            h('section', { className: 'dshh-section' },
              h('h4', null, '常用入口'),
              h(Toggle, { checked: draft.links.auto, onChange: (value) => edit(['links', 'auto'], value), text: '自动抓取本机 Chrome 最常访问站点' }),
              h('div', { className: 'dshh-row-inline' },
                h('button', { type: 'button', className: 'dshh-btn', disabled: busy, onClick: refreshBrowser }, '立即重新抓取'),
                h('span', { className: 'dshh-hint' }, browserEntries ? `${browserEntries.visited.length} 个站点 · ${browserEntries.source || '未检测到 Chrome'}` : '')),
              h(Label, { text: `自动入口数量：${draft.links.autoCount}` },
                h('input', { type: 'range', min: 4, max: 16, step: 1, value: draft.links.autoCount, onChange: (e) => edit(['links', 'autoCount'], Number(e.target.value)) })),
              h(Label, { text: '位置' },
                h('select', { style: FIELD, value: draft.links.place, onChange: (e) => edit(['links', 'place'], e.target.value) },
                  h('option', { value: 'below' }, '输入框下方'),
                  h('option', { value: 'above' }, '输入框上方'))),
              h(Label, { text: '自定义入口（JSON：title + url）' },
                h('textarea', { style: { ...FIELD, height: 96, fontFamily: 'ui-monospace, monospace' }, value: linksDraft, onChange: (e) => setLinksDraft(e.target.value), onBlur: commitLinks }))),

            h('section', { className: 'dshh-section' },
              h('h4', null, '组件'),
              h(Toggle, { checked: draft.widgets.enabled, onChange: (value) => edit(['widgets', 'enabled'], value), text: '在输入框上方显示组件行' }),
              h('p', { className: 'dshh-hint' }, `最多 ${WIDGET_MAX} 个，一行排列，每个约等于一张工作区卡片。目前提供 API 用量组件（DeepSeek / MiniMax / Cline Pass / OpenCode Go），后续可加更多类型。`),
              widgetList.map((item, index) => h('div', { className: 'dshh-widget-edit', key: item.id || index },
                h('span', { className: 'dshh-widget-edit-index' }, String(index + 1)),
                h('select', {
                  style: FIELD,
                  value: item.provider,
                  onChange: (e) => patchWidget(index, { provider: e.target.value }),
                }, widgetProviderOptions(item.provider).map((provider) => h('option', { key: provider.id, value: provider.id }, provider.label))),
                h('button', { type: 'button', className: 'dshh-icon-btn', title: '移除这个组件', onClick: () => removeWidget(index) }, '✕'))),
              widgetList.length === 0 ? h('p', { className: 'dshh-hint' }, '还没有组件，点下面的「添加组件」加一个。') : null,
              h('div', { className: 'dshh-row-inline' },
                h('button', { type: 'button', className: 'dshh-btn', disabled: widgetList.length >= WIDGET_MAX, onClick: addWidget },
                  widgetList.length >= WIDGET_MAX ? `已满 ${WIDGET_MAX} 个` : '＋ 添加组件'),
                h('button', {
                  type: 'button',
                  className: 'dshh-btn',
                  disabled: busy,
                  onClick: () => { setNote('正在刷新用量…'); loadUsage(true) },
                }, '刷新数据')),
              h(Label, { text: `自动刷新：${draft.widgets.refreshMinutes} 分钟` },
                h('input', { type: 'range', min: 1, max: 60, step: 1, value: draft.widgets.refreshMinutes, onChange: (e) => edit(['widgets', 'refreshMinutes'], Number(e.target.value)) }))),

            note === '' ? null : h('p', { className: 'dshh-note' }, note)),
          h('footer', { className: 'dshh-modal-foot' },
            h('button', { type: 'button', className: 'dshh-btn', onClick: () => window.dispatchEvent(new CustomEvent('dshh:close')) }, '关闭'),
            h('button', { type: 'button', className: 'dshh-btn dshh-btn-primary', disabled: busy, onClick: save }, busy ? '处理中…' : '保存'))))
    }

    function mountDialog() {
      if (dialogRoot !== null) return
      const host = document.createElement('div')
      host.id = 'dshh-dialog'
      document.body.appendChild(host)
      const close = () => {
        const root = dialogRoot
        dialogRoot = null
        if (root !== null) root.unmount()
        host.remove()
        window.removeEventListener('dshh:close', close)
      }
      const root = require('react-dom/client').createRoot(host)
      dialogRoot = root
      root.render(h(SettingsDialog, null))
      window.addEventListener('dshh:close', close)
    }

    /**
     * The composer card is the visual anchor for the whole dock lane, so mirror its
     * measured width instead of trusting an implementation-detail CSS variable.
     */
    function watchComposerWidth() {
      let observed = null
      let retries = 0
      let lastWidth = 0
      const apply = () => {
        const card = document.querySelector('[data-composer-card]')
        if (card === null) return false
        const width = Math.round(card.getBoundingClientRect().width)
        if (width > 0 && width !== lastWidth) {
          lastWidth = width
          document.documentElement.style.setProperty('--dshh-deck-width', `${width}px`)
        }
        return true
      }
      const observer = new ResizeObserver(() => { apply() })
      const attach = () => {
        const card = document.querySelector('[data-composer-card]')
        if (card === null) return false
        if (card !== observed) {
          if (observed !== null) observer.unobserve(observed)
          observed = card
          observer.observe(card)
        }
        apply()
        return true
      }
      const tick = () => {
        if (attach() || retries > 20) return
        retries += 1
        window.setTimeout(tick, 400)
      }
      const onResize = () => { attach(); apply() }
      tick()
      window.addEventListener('resize', onResize)
      return () => {
        window.removeEventListener('resize', onResize)
        observer.disconnect()
        document.documentElement.style.removeProperty('--dshh-deck-width')
      }
    }

    // ── slot components ───────────────────────────────────────────────────────
    function useConfig() {
      const current = useHomepage()
      return current.config
    }

    function FolderIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.6.8l.9 1.2h6.9A2.5 2.5 0 0 1 21 9.5v7.9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z' }))
    }

    function avatarHue(key) {
      let hash = 7
      const text = String(key)
      for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 360
      return hash
    }

    function avatarStyle(key) {
      const hue = avatarHue(key)
      return { background: `linear-gradient(135deg, hsl(${hue} 56% 48%), hsl(${(hue + 42) % 360} 54% 38%))` }
    }

    function initialOf(text) {
      const trimmed = String(text === undefined || text === null ? '' : text).trim()
      return trimmed === '' ? '·' : trimmed.slice(0, 1).toUpperCase()
    }

    /**
     * The deck is the *homepage* deck: it belongs to the new-session hero and gets out
     * of the way once a real conversation is running (unless the user opts out).
     */
    function deckHidden(state, config) {
      const workspaces = config !== null && typeof config === 'object' ? config.workspaces : null
      if (workspaces === null || typeof workspaces !== 'object' || workspaces.onlyOnHero !== true) return false
      const session = state !== null && typeof state === 'object' ? state.session : null
      if (!session || session.id === null) return false
      return session.blank === false
    }

    /** One muted section caption per deck; it spans the whole grid row so the cards keep
     *  their column rhythm. `trailing` sits at the right edge of that caption line. */
    function deckHead(text, trailing = null) {
      return h('span', { key: 'head', className: 'dshh-deck-head' }, [
        h('span', { key: 'text', className: 'dshh-deck-head-text' }, text),
        trailing,
      ])
    }

    /**
     * One quiet `↻` on a deck caption line. It owns its busy state, so the caller only
     * supplies the async work — a rejected pull ends the spin instead of leaving it on.
     */
    function DeckRefreshButton(props) {
      const [busy, setBusy] = useState(false)
      const run = () => {
        if (busy === true) return
        setBusy(true)
        Promise.resolve()
          .then(() => props.onRefresh())
          .catch(() => {})
          .finally(() => setBusy(false))
      }
      return h('button', {
        type: 'button',
        className: `dshh-deck-refresh${busy ? ' dshh-deck-refresh-busy' : ''}`,
        title: busy ? props.busyTitle : props.title,
        'aria-label': props.ariaLabel || props.title,
        onClick: run,
      }, h('span', { key: 'glyph', className: 'dshh-deck-refresh-glyph' }, '↻'))
    }

    /**
     * Row-level refresh for the widget deck. Every card reads the same shared payload, so
     * this is exactly the `loadUsage(true)` a card click triggers — it just stays reachable
     * from the caption line, including while the cards themselves look busy or stale.
     */
    function WidgetRefreshButton() {
      return h(DeckRefreshButton, {
        title: '刷新组件数据',
        busyTitle: '正在刷新组件…',
        ariaLabel: '刷新组件数据',
        onRefresh: () => loadUsage(true),
      })
    }

    function WorkspaceRow(props) {
      const current = useHomepage()
      const config = current.config
      const slots = config.workspaces
      const store = props.useWorkspaces ? props.useWorkspaces((value) => value) : null
      const sessions = props.useSessions ? props.useSessions((value) => value) : null
      // Bumped after a successful pull: the ranking reads timestamps and the current
      // clock, so it has to re-run even when the store's snapshot object is unchanged.
      const [revision, setRevision] = useState(0)
      const sessionIds = useMemo(() => {
        const items = store && Array.isArray(store.items) ? store.items : []
        const out = []
        for (const workspace of items) {
          for (const sessionId of workspace.sessionIds || []) out.push(sessionId)
        }
        return out
      }, [store])
      // Every time the homepage is (re)opened — first mount, and again whenever the
      // new-session hero comes back — replace whatever this page loaded at boot with the
      // host's current activity. The shared throttle keeps it from becoming a poll.
      const heroOpen = current.session === null || current.session === undefined
        ? true
        : current.session.id === null || current.session.blank === true
      useEffect(() => {
        if (slots.enabled !== true || heroOpen !== true) return undefined
        let alive = true
        const pull = pullWorkspaceActivity({ sessionIds })
        if (pull === null) return undefined
        pull.then(() => { if (alive) setRevision((value) => value + 1) }, () => {})
        return () => { alive = false }
      }, [heroOpen, slots.enabled, sessionIds])
      // The homepage is the idle screen: coming back to the window is exactly the moment
      // the ranking should catch up (this app may have been running in the background for
      // hours). The same pull throttle keeps focus ping-pong from turning into polling.
      useEffect(() => {
        if (slots.enabled !== true) return undefined
        let alive = true
        const wake = () => {
          if (document.visibilityState !== 'visible') return
          if (workspacePullAt > 0 && Date.now() - workspacePullAt < WORKSPACE_FOCUS_GAP) return
          const pull = pullWorkspaceActivity({ sessionIds })
          if (pull === null) return
          pull.then(() => { if (alive) setRevision((value) => value + 1) }, () => {})
        }
        window.addEventListener('focus', wake)
        document.addEventListener('visibilitychange', wake)
        return () => {
          alive = false
          window.removeEventListener('focus', wake)
          document.removeEventListener('visibilitychange', wake)
        }
      }, [slots.enabled, sessionIds])
      const rows = useMemo(
        () => rankWorkspaces(store, sessions, slots),
        [store, sessions, slots.count, slots.strategy, slots.halfLifeDays, revision],
      )
      const revalidate = () => {
        const pull = pullWorkspaceActivity({ force: true, sessionIds })
        if (pull === null) {
          setRevision((value) => value + 1)
          return undefined
        }
        return pull.then(
          () => setRevision((value) => value + 1),
          () => setRevision((value) => value + 1),
        )
      }
      if (deckHidden(current, config)) return null
      if (slots.enabled !== true || rows.length === 0) return null
      return h('div', { className: `dshh-deck${slots.place === 'below' ? ' dshh-below' : ''}`, 'data-dshh': 'workspaces' }, [
        deckHead('最近工作区', h(DeckRefreshButton, {
          key: 'refresh',
          title: workspacePullError !== '' ? `刷新失败：${workspacePullError}` : '刷新最近工作区（重新读取各工作区最近使用时间）',
          busyTitle: '正在刷新最近工作区…',
          ariaLabel: '刷新最近工作区',
          onRefresh: revalidate,
        })),
        ...rows.map((row) => h('button', {
          key: row.id,
          type: 'button',
          className: 'dshh-card',
          title: `${row.title}\n${row.path || ''}\n${row.sessions} 个会话 · ${row.turns} 轮`,
          onClick: () => {
            const ui = pluginCtx && pluginCtx.get('uiWorkspace')
            if (ui && typeof ui.openWorkspace === 'function') ui.openWorkspace(row.id)
          },
        }, [
          h('span', { key: 'avatar', className: 'dshh-folder' }, FolderIcon()),
          h('span', { key: 'body', className: 'dshh-card-body' }, [
            h('span', { key: 'title', className: 'dshh-card-title' }, row.title),
            h('span', { key: 'meta', className: 'dshh-card-meta' },
              `${row.sessions} 个会话 · ${row.lastActive ? ago(row.lastActive) : '暂无会话'}`)
          ]),
        ])),
      ])
    }

    function LinksRow(props) {
      const current = useHomepage()
      const config = current.config
      const [, bump] = React.useReducer((value) => value + 1, 0)
      useEffect(() => {
        if (!config.links.auto || browserEntries !== null) return
        let alive = true
        api('/browser').then((value) => { if (alive) { browserEntries = value; bump() } }).catch(() => {})
        return () => { alive = false }
      }, [config.links.auto])
      const entries = useMemo(() => {
        const custom = Array.isArray(config.links.items) ? config.links.items.filter((item) => item && item.url) : []
        const auto = config.links.auto && browserEntries !== null ? browserEntries.visited.slice(0, Number(config.links.autoCount) || 6) : []
        const seen = new Set()
        const out = []
        for (const item of [...custom, ...auto]) {
          if (seen.has(item.url)) continue
          seen.add(item.url)
          out.push(item)
        }
        return out.slice(0, 12)
      }, [config.links, browserEntries])
      if (deckHidden(current, config)) return null
      if (entries.length === 0) return null
      return h('div', { className: `dshh-deck dshh-deck-links${config.links.place !== 'above' ? ' dshh-below' : ''}`, 'data-dshh': 'links' }, [
        deckHead('常用站点'),
        ...entries.map((entry) => h('a', {
          key: entry.url,
          className: 'dshh-card',
          href: entry.url,
          target: '_blank',
          rel: 'noreferrer',
          title: entry.url,
        }, [
          entry.icon
            ? h('img', { key: 'icon', className: 'dshh-favicon', src: entry.icon, alt: '' })
            : h('span', { key: 'icon', className: 'dshh-avatar', style: avatarStyle(hostOf(entry.url)) }, initialOf(hostOf(entry.url))),
          h('span', { key: 'body', className: 'dshh-card-body' }, [
            h('span', { key: 'title', className: 'dshh-card-title' }, entry.title || hostOf(entry.url)),
            h('span', { key: 'meta', className: 'dshh-card-meta' }, hostOf(entry.url)),
          ]),
        ])),
      ])
    }

    // ── usage widgets ─────────────────────────────────────────────────────────
    const WIDGET_MAX = 4

    const PROVIDER_LOOK = {
      deepseek: { glyph: 'D', color: '#4d6bfe' },
      minimax: { glyph: 'M', color: '#ff7043' },
      'cline-pass': { glyph: 'C', color: '#7c5cff' },
      'opencode-go': { glyph: 'G', color: '#5a5858' },
      tuzi: { glyph: 'T', color: '#2fae7a' },
      openai: { glyph: 'O', color: '#10a37f' },
      anthropic: { glyph: 'A', color: '#c9855f' },
    }

    const PROVIDER_LABEL = {
      deepseek: 'DeepSeek',
      minimax: 'MiniMax',
      'cline-pass': 'Cline Pass',
      'opencode-go': 'OpenCode Go',
      tuzi: 'Tuzi',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
    }

    /**
     * Options for one widget's provider select. A config can name a provider this build
     * does not offer (older config, hand-edited file, newer host half); keeping it as a
     * synthetic option means the select shows the real value instead of silently
     * falling back to the first entry.
     */
    function widgetProviderOptions(provider) {
      const id = String(provider ?? '')
      if (WIDGET_PROVIDERS.some((entry) => entry.id === id)) return WIDGET_PROVIDERS
      return [...WIDGET_PROVIDERS, { id, label: `${providerLabel(id)}（自定义）` }]
    }

    /** Providers the settings panel offers for the usage widget (add a host adapter to extend). */
    const WIDGET_PROVIDERS = [
      { id: 'deepseek', label: 'DeepSeek · 账户余额' },
      { id: 'minimax', label: 'MiniMax · 用量 / 配额' },
      { id: 'cline-pass', label: 'Cline Pass · 订阅额度' },
      { id: 'opencode-go', label: 'OpenCode Go · 订阅额度' },
    ]

    function providerLabel(id) {
      const key = String(id ?? '')
      return PROVIDER_LABEL[key.toLowerCase()] || key || '未知'
    }

    function providerLook(id) {
      const known = PROVIDER_LOOK[String(id ?? '').toLowerCase()]
      if (known !== undefined) return known
      return { glyph: initialOf(id), color: `hsl(${avatarHue(id)} 52% 46%)` }
    }

    /** Config sanitising mirrors the host: at most four cards, only usable entries. */
    function widgetItems(config) {
      const widgets = config.widgets
      if (widgets === null || typeof widgets !== 'object' || widgets.enabled !== true) return []
      const items = Array.isArray(widgets.items) ? widgets.items : []
      return items
        .filter((item) => item !== null && typeof item === 'object'
          && typeof item.provider === 'string' && item.provider !== ''
          && (item.type === undefined || item.type === 'usage'))
        .slice(0, WIDGET_MAX)
    }

    function usageOf(id) {
      const list = usageData !== null && Array.isArray(usageData.widgets) ? usageData.widgets : []
      return list.find((entry) => entry !== null && typeof entry === 'object' && entry.id === id) ?? null
    }

    /**
     * Per-provider click handlers for the widget cards. Empty on purpose: today a click
     * refreshes the shared payload, and future actions (open the vendor console, start a
     * session, …) get added here as `provider → (item) => void` without touching the card.
     */
    const WIDGET_ACTIONS = {}

    function activateWidget(item) {
      const provider = item !== null && typeof item === 'object' ? String(item.provider ?? '') : ''
      const action = WIDGET_ACTIONS[provider]
      if (typeof action === 'function') {
        action(item)
        return
      }
      loadUsage(true)
    }

    /**
     * `11/21` — the monthly window's reset date, appended straight after the detail line so
     * it is readable without waiting out the hover tooltip. An absolute date reads the same
     * on every refresh (a countdown would not); the tooltip still carries the minute-accurate
     * countdown. Empty when the provider has no monthly window (MiniMax) or it is uncapped.
     */
    function resetNote(reset) {
      if (reset === null || typeof reset !== 'object') return ''
      const at = Number(reset.at)
      // A widget cached from just before the reset instant would otherwise keep printing a
      // date in the past for up to the 60 s payload cache, so past dates render nothing.
      if (!Number.isFinite(at) || at <= Date.now()) return ''
      const date = new Date(at)
      if (Number.isNaN(date.getTime())) return ''
      const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}/`
      return `${year}${date.getMonth() + 1}/${date.getDate()}`
    }

    function WidgetCard(props) {
      const item = props.item
      const usage = usageOf(item.id)
      const look = providerLook(item.provider)
      const label = (usage && usage.label) || item.label || providerLabel(item.provider)
      const value = usage && usage.primary
        ? usage.primary
        : usageError !== '' ? '—' : '…'
      const detail = usage
        ? (usage.detail || usage.secondary || '')
        : usageError !== '' ? '获取失败 · 点击重试' : '正在获取…'
      const tone = (usage && usage.tone) || (usageError !== '' ? 'error' : 'neutral')
      const secondary = (usage && usage.secondary) || ''
      const reset = usage ? resetNote(usage.reset) : ''
      const tip = [
        `${label}${secondary !== '' ? ` · ${secondary}` : ''}`,
        detail,
        usage && usage.breakdown ? usage.breakdown : '',
        usage && usage.stale ? '（缓存数据）' : '',
        '点击刷新',
      ].filter((line) => line !== '').join('\n')
      return h('button', {
        type: 'button',
        className: `dshh-widget${usage ? '' : ' dshh-widget-loading'}${usageBusy ? ' dshh-widget-busy' : ''}`,
        'data-tone': tone,
        title: tip,
        onClick: () => { activateWidget(item) },
      }, [
        h('span', { key: 'top', className: 'dshh-widget-top' }, [
          h('span', { key: 'dot', className: 'dshh-widget-dot', style: { background: look.color } }, look.glyph),
          h('span', { key: 'label', className: 'dshh-widget-label' }, label),
        ]),
        h('span', { key: 'value', className: 'dshh-widget-value' },
          value,
          secondary !== '' ? h('em', { key: 'unit', className: 'dshh-widget-unit' }, secondary) : null),
        h('span', { key: 'detail', className: 'dshh-widget-detail' },
          detail,
          reset !== '' ? h('span', { key: 'reset', className: 'dshh-widget-reset' }, [
            ' · ', reset,
            // Only spelled out when the card is wide enough; a narrow card keeps the bare
            // date instead of ellipsising the word away.
            h('span', { key: 'word', className: 'dshh-widget-reset-word' }, ' 重置'),
          ]) : null),
      ])
    }

    function WidgetsRow() {
      const current = useHomepage()
      const config = current.config
      const items = widgetItems(config)
      // A slot entry that throws is abdicated by the harness for the rest of the page,
      // so every optional field is read defensively here.
      const widgetsConfig = config !== null && typeof config === 'object' && config.widgets !== null
        && typeof config.widgets === 'object' ? config.widgets : null
      if (widgetsConfig === null || items.length === 0) return null
      if (deckHidden(current, config)) return null
      const minutes = Math.max(1, Math.min(120, Number(widgetsConfig.refreshMinutes) || 5))
      const signature = items.map((item) => `${item.id}:${item.provider}`).join('|')
      // Up to three cards keep the workspace-card footprint; a fourth joins the same row.
      const columns = Math.min(WIDGET_MAX, Math.max(3, items.length))
      return h(WidgetRowBody, { key: signature, columns, items, minutes })
    }

    function WidgetRowBody(props) {
      useEffect(() => {
        let alive = true
        const tick = () => { loadUsage(false) }
        tick()
        // Only the shared loader writes module state; the timer just re-requests.
        const timer = window.setInterval(() => { if (alive) tick() }, props.minutes * 60_000)
        return () => { alive = false; window.clearInterval(timer) }
      }, [props.minutes])
      return h('div', {
        className: 'dshh-deck dshh-deck-widgets',
        'data-dshh': 'widgets',
        'data-count': props.columns,
      }, [
        deckHead('自定义组件', h(WidgetRefreshButton, { key: 'refresh' })),
        ...props.items.map((item) => h(WidgetCard, { key: item.id || item.provider, item })),
      ])
    }

    function FooterRow() {
      const current = useHomepage()
      if (deckHidden(current, current.config)) return null
      return h('div', { className: 'dshh-footer' },
        h('button', { type: 'button', className: 'dshh-gear', title: '自定义这个主页', onClick: openSettings },
          [h('span', { key: 'glyph' }, '⚙'), h('span', { key: 'text' }, '自定义主页')]))
    }

    function HeroLogo() {
      const current = useHomepage()
      if (current.assets.logo !== true) return null
      return h('img', {
        className: 'dshh-hero-logo',
        src: `${API}/asset?kind=logo&v=${current.config.logo && current.config.logo.asset ? current.config.logo.asset.version : 0}`,
        alt: '',
      })
    }

    function SidebarMark() {
      const current = useHomepage()
      if (current.assets.logo !== true) return null
      return h('img', {
        className: 'dshh-sidebar-mark',
        src: `${API}/asset?kind=logo&v=${current.config.logo && current.config.logo.asset ? current.config.logo.asset.version : 0}`,
        alt: '',
      })
    }

    function SidebarName() {
      const current = useHomepage()
      const text = current.config.logo && current.config.logo.wordmark
      if (current.assets.logo !== true || !text) return null
      return h('span', { className: 'dshh-sidebar-name' }, text)
    }

    // ── plugin body ───────────────────────────────────────────────────────────
    const inject = ['slots']

    function apply(ctx) {
      window.__dshMyNewHomeCtx = ctx
      pluginCtx = ctx
      let themeDisposer = null
      let brandDisposers = []

      const syncBrand = () => {
        for (const dispose of brandDisposers) {
          try { dispose() } catch {}
        }
        brandDisposers = []
        if (snapshot.assets.logo !== true) return
        // Slot names differ between harness versions: one missing declaration must never
        // take the rest of the homepage down with it.
        const occupy = (slot, component) => {
          try {
            brandDisposers.push(ctx.slots.inject(slot, () => ctx.slots.register({ name: slot }, component)))
          } catch (error) {
            console.warn(`[${PKG}] slot ${slot} unavailable`, error)
          }
        }
        occupy('conversation.hero.brand.mark', HeroLogo)
        occupy('sidebar.brand.mark', SidebarMark)
        occupy('sidebar.brand.name', SidebarName)
      }

      const applyTheme = () => {
        const theme = ctx.get('theme')
        if (!theme || typeof theme.overrideTokens !== 'function') return
        if (themeDisposer !== null) {
          try { themeDisposer() } catch {}
          themeDisposer = null
        }
        themeDisposer = theme.overrideTokens(PKG, themeTokens(snapshot.config.theme))
      }

      react = () => {
        const hideTagline = snapshot.assets.logo === true && snapshot.config.logo.hideHeroTagline === true
        if (hideTagline) document.documentElement.setAttribute('data-dshh-hide-tagline', '1')
        else document.documentElement.removeAttribute('data-dshh-hide-tagline')
        if (snapshot.config.workspaces.onlyOnHero === true) document.documentElement.setAttribute('data-dshh-hero-only', '1')
        else document.documentElement.removeAttribute('data-dshh-hero-only')
        try { applyTheme() } catch (error) { console.warn(`[${PKG}] theme skipped`, error) }
        try { applyBackground(snapshot) } catch (error) { console.warn(`[${PKG}] background skipped`, error) }
        try { syncBrand() } catch (error) { console.warn(`[${PKG}] brand slots skipped`, error) }
      }

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = PKG
        style.dataset.pluginCss = PLUGIN_CSS
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-my-newhome: styles')

      ctx.effect(() => {
        refresh().catch(() => {})
        const stopWatching = watchComposerWidth()
        let stopSessions = null
        try {
          const store = ctx.get('sessions')
          if (store && store.list && typeof store.list.subscribe === 'function') {
            stopSessions = store.list.subscribe(() => publishSession(readSession()))
          }
        } catch (error) {
          console.warn(`[${PKG}] session tracking unavailable`, error)
        }
        window.addEventListener(OPEN_EVENT, mountDialog)
        return () => {
          stopWatching()
          if (typeof stopSessions === 'function') stopSessions()
          window.removeEventListener(OPEN_EVENT, mountDialog)
          if (themeDisposer !== null) themeDisposer()
          for (const dispose of brandDisposers) { try { dispose() } catch {} }
          const layer = document.getElementById('dshh-bg')
          if (layer !== null) layer.remove()
          document.documentElement.removeAttribute('data-dshh-bg')
          document.documentElement.removeAttribute('data-dshh-hide-tagline')
          document.documentElement.removeAttribute('data-dshh-hero-only')
        }
      }, 'dsh-my-newhome: lifecycle')

      ctx.slots.inject('conversation.input.dock', () => {
        const parts = [
          ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-workspaces', order: 10 }, WorkspaceRow),
          ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-widgets', order: 11 }, WidgetsRow),
          ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-links', order: 12 }, LinksRow),
          ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-footer', order: 13 }, FooterRow),
        ]
        return () => { for (const dispose of parts) dispose() }
      })
    }

    // ── styles ────────────────────────────────────────────────────────────────
    const CSS = `
#dshh-bg{position:fixed;inset:-24px;z-index:-1;pointer-events:none;background-repeat:no-repeat;background-position:center center;transform:translateZ(0)}
#dshh-bg::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,var(--dshh-dim,.28))}
html[data-dshh-bg] body,html[data-dshh-bg] #root,html[data-dshh-bg] #app{background:transparent!important}
html[data-dshh-bg],html[data-dshh-bg] body{--dsw-alias-bg-base:transparent!important}
/* keep the brand-mark slot (our logo lives inside the headline row) and drop only the text parts */
html[data-dshh-hide-tagline] [class*="headline"] > :not(:has(.dshh-hero-logo)){display:none!important}
html[data-dshh-hide-tagline] [class*="previewBadge"]{display:none!important}
/* The composer stack only carries the hero marker while the new-session hero is on
   screen, so this keeps the homepage decks out of every existing conversation. */
html[data-dshh-hero-only] [class*="composerStack"]:not([class*="composerHero"]) .dshh-deck,
html[data-dshh-hero-only] [class*="composerStack"]:not([class*="composerHero"]) .dshh-footer{display:none!important}

.dshh-deck{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;box-sizing:border-box;
  width:min(var(--dshh-deck-width,var(--dsh-composer-card-max-width,760px)),100%);
  margin:0 auto;padding:0}
/* One explicit stacking ladder so every deck has a stable seat: hero → workspace deck →
   widget deck → links → the harness mode/workspace row → composer. The widget row sits
   above that row (the Agent-preset / 模式 selector) on request, not between it and the
   composer. */
[class*="composerStack"] > :first-child{order:-7}
.dshh-deck{order:-6;margin-bottom:6px}
.dshh-deck-widgets{order:-5;margin-bottom:6px}
.dshh-deck-links{order:-4;margin-bottom:0}
[class*="heroWorkspaceRow"]{order:-3}
.dshh-deck.dshh-below{order:999}
/* Section caption: quiet, one line, never a card-sized block of its own. The optional
   trailing refresh control lives on this line, so it adds no row of its own. */
.dshh-deck-head{grid-column:1/-1;display:flex;align-items:center;gap:8px;
  margin:0 2px -2px;font-size:11px;font-weight:500;
  line-height:14px;letter-spacing:.4px;color:var(--dsw-alias-label-tertiary,#767c88)}
.dshh-deck-head-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshh-deck-refresh{flex:none;display:grid;place-items:center;width:16px;height:16px;margin:-1px 0;padding:0;
  border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:11px;
  line-height:1;transition:background .12s,color .12s}
.dshh-deck-refresh:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#e9eaee) 9%,transparent);
  color:var(--dsw-alias-label-secondary,#a8aeba)}
.dshh-deck-refresh:active{background:color-mix(in srgb,var(--dsw-alias-label-primary,#e9eaee) 14%,transparent)}
.dshh-deck-refresh-glyph{display:inline-block}
.dshh-deck-refresh-busy .dshh-deck-refresh-glyph{animation:dshh-spin .8s linear infinite}
@keyframes dshh-spin{to{transform:rotate(360deg)}}
.dshh-card{display:flex;align-items:center;gap:10px;min-width:0;min-height:60px;padding:10px 13px;border-radius:12px;
  box-sizing:border-box;text-align:left;text-decoration:none;cursor:pointer;font:inherit;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#15181d) 76%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#23262c) 90%,transparent);
  transition:background .16s,border-color .16s,transform .16s,box-shadow .16s}
.dshh-card:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#1b1e24) 90%,transparent);
  border-color:var(--dsw-alias-border-l3,#3d434e);transform:translateY(-1px);
  box-shadow:0 6px 18px rgba(0,0,0,.18)}
.dshh-card:active{transform:translateY(0)}
.dshh-avatar{flex:none;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;
  font-size:11.5px;font-weight:700;color:#fff;letter-spacing:.2px;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
.dshh-folder{flex:none;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;
  color:var(--dsw-alias-label-secondary,#a8aeba);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-3,#262a31) 62%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#2f333b) 70%,transparent);
  transition:color .16s,border-color .16s}
.dshh-card:hover .dshh-folder{color:var(--dsw-alias-brand-primary,#4d6bfe);
  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 55%,transparent)}
.dshh-favicon{flex:none;width:20px;height:20px;border-radius:5px;object-fit:contain;margin:0 3px}
.dshh-card-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshh-card-title{font-size:13px;font-weight:600;line-height:1.25;color:var(--dsw-alias-label-primary,#e9eaee);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshh-card-meta{font-size:11px;line-height:1.2;color:var(--dsw-alias-label-tertiary,#767c88);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshh-deck-links .dshh-card{min-height:56px}

/* Usage widgets: same footprint as a workspace card — three short lines. A quota card
   appends the monthly reset date to the detail line; the card is a query container so the
   word 重置 only appears when there is room for it (narrow cards keep the bare date). */
.dshh-deck-widgets{grid-template-columns:repeat(3,minmax(0,1fr))}
.dshh-deck-widgets[data-count="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
.dshh-widget{display:flex;flex-direction:column;gap:1px;min-width:0;min-height:64px;padding:9px 12px;border-radius:12px;
  container-type:inline-size;
  box-sizing:border-box;text-align:left;font:inherit;cursor:pointer;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#15181d) 76%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#23262c) 90%,transparent);
  transition:background .16s,border-color .16s,transform .16s,box-shadow .16s}
.dshh-widget:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#1b1e24) 90%,transparent);
  border-color:var(--dsw-alias-border-l3,#3d434e);transform:translateY(-1px);
  box-shadow:0 6px 18px rgba(0,0,0,.18)}
.dshh-widget:active{transform:translateY(0)}
.dshh-widget-loading,.dshh-widget-busy{opacity:.72}
.dshh-widget-top{display:flex;align-items:center;gap:6px;min-width:0}
.dshh-widget-dot{flex:none;width:15px;height:15px;border-radius:5px;display:grid;place-items:center;
  font-size:9px;font-weight:700;line-height:1;color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
.dshh-widget-label{font-size:10.5px;letter-spacing:.2px;color:var(--dsw-alias-label-tertiary,#767c88);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshh-widget-value{font-size:16px;font-weight:650;line-height:1.2;color:var(--dsw-alias-label-primary,#e9eaee);
  font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshh-widget-unit{margin-left:4px;font-size:10.5px;font-weight:500;font-style:normal;color:var(--dsw-alias-label-tertiary,#767c88)}
.dshh-widget-detail{font-size:10.5px;line-height:1.25;color:var(--dsw-alias-label-tertiary,#767c88);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshh-widget-reset{font-variant-numeric:tabular-nums}
.dshh-widget-reset-word{display:none}
@container (min-width:168px){.dshh-widget-reset-word{display:inline}}
.dshh-widget[data-tone="warn"] .dshh-widget-value{color:#e0a33a}
.dshh-widget[data-tone="error"] .dshh-widget-value{color:#e0635b}

.dshh-footer{display:flex;justify-content:center;order:1000;box-sizing:border-box;
  width:min(var(--dshh-deck-width,var(--dsh-composer-card-max-width,760px)),100%);
  margin:0 auto;padding:0}
.dshh-gear{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:7px;cursor:pointer;
  font:inherit;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#767c88);
  background:transparent;border:1px solid transparent;transition:color .15s,background .15s,border-color .15s}
.dshh-gear:hover{color:var(--dsw-alias-label-secondary,#a8aeba);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#1f232a) 70%,transparent);
  border-color:color-mix(in srgb,var(--dsw-alias-border-l2,#2f333b) 80%,transparent)}

.dshh-hero-logo{display:block;max-height:96px;max-width:min(420px,70vw);object-fit:contain;margin:0 auto}
.dshh-sidebar-mark{width:22px;height:22px;object-fit:contain;display:block}
.dshh-sidebar-name{font-size:13px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-primary,#eef1f6);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.dshh-modal-backdrop{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(6,8,12,.5);backdrop-filter:blur(3px)}
.dshh-modal{width:min(560px,92vw);max-height:84vh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;
  background:var(--dsw-alias-bg-base,#15181d);border:1px solid var(--dsw-alias-border-l2,#2c313a);box-shadow:0 24px 60px rgba(0,0,0,.45);
  color:var(--dsw-alias-label-primary,#eef1f6);font-size:13px}
.dshh-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#23272f)}
.dshh-modal-body{padding:12px 16px 18px;overflow:auto;display:flex;flex-direction:column;gap:18px}
.dshh-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1,#23272f)}
.dshh-section{display:flex;flex-direction:column;gap:9px}
.dshh-section h4{margin:0;font-size:12px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8b919c)}
.dshh-field{display:flex;flex-direction:column;gap:5px}
.dshh-field-label{font-size:12px;color:var(--dsw-alias-label-secondary,#b9bfc9)}
.dshh-toggle{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-secondary,#c3c9d4)}
.dshh-row-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshh-duo{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dshh-widget-edit{display:flex;align-items:center;gap:8px}
.dshh-widget-edit select{flex:1;min-width:0}
.dshh-widget-edit-index{flex:none;width:18px;height:18px;border-radius:6px;display:grid;place-items:center;
  font-size:10px;color:var(--dsw-alias-label-tertiary,#8b919c);background:var(--dsw-alias-bg-layer-2,#1f232a)}
.dshh-btn{height:30px;padding:0 14px;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;
  background:var(--dsw-alias-bg-layer-2,#1f232a);color:var(--dsw-alias-label-primary,#e8eaee);border:1px solid var(--dsw-alias-border-l2,#333a45)}
.dshh-btn:hover{border-color:var(--dsw-alias-border-l3,#4a5160)}
.dshh-btn:disabled{opacity:.5;cursor:default}
.dshh-btn-primary{background:var(--dsw-alias-brand-primary,#4f7cff);color:#fff;border-color:transparent}
.dshh-icon-btn{width:26px;height:26px;border-radius:8px;cursor:pointer;background:transparent;border:none;color:var(--dsw-alias-label-tertiary,#8b919c);font-size:13px}
.dshh-icon-btn:hover{background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#eef)}
.dshh-hint{margin:0;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b919c)}
.dshh-note{margin:0;font-size:12px;color:var(--dsw-alias-state-business-primary,#7aa2ff)}
input[type="range"]{width:100%;accent-color:var(--dsw-alias-brand-primary,#4f7cff)}
input[type="color"].dshh-color{width:72px!important;flex:none;cursor:pointer}
@media (max-width:720px){.dshh-deck,.dshh-deck-widgets,.dshh-deck-widgets[data-count="4"]{grid-template-columns:repeat(2,minmax(0,1fr))}}
`

    const exports = { name: PKG, inject, apply }
    // Test-only surface, the mirror of the host half's `internals` export. Non-enumerable
    // so the module loader's own enumerations cannot see it; the smoke test drives the
    // pure ranking helpers through it with fake stores.
    Object.defineProperty(exports, 'internals', {
      value: { rankWorkspaces, sessionTime, sessionTurns, ago, resetNote },
      enumerable: false,
    })
    return exports
  },
})
