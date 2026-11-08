/* ────────────────────────────────────────────────────────────────────────────
   DSH 自定义主页 · 布局原型 — grid engine & interactions
   24 栏 1×1 自由网格 / 组件抽屉 / 拖放 / 缩放 / 避让 / 撤销 / 预设 / 持久化
   ──────────────────────────────────────────────────────────────────────────── */

;(function () {
  'use strict'

  /* ── constants ─────────────────────────────────────────────────────────── */

  const COLS = 24
  const GAP = 6
  const MIN_ROWS = 20
  // 行高固定：左右栏开合/窗口变宽只改变列宽，不改变垂直尺寸（对齐 DSH 的三列 frame 行为）
  const ROW_H = 30
  const STORE_KEY = 'dsh-home-prototype-v1'
  const CAT_ORDER = ['base', 'plan', 'pad', 'pc']
  const CAT_LABEL = {
    base: 'DSH 基础',
    plan: '现行规划',
    pad: 'Pad 组件',
    pc: 'PC 组件',
  }
  const CAT_HINT = {
    base: 'Logo / 标语 / 输入框',
    plan: '与插件当前规划一致',
    pad: '触屏语义 · 大圆角',
    pc: '桌面工作台 · 高密度',
  }

  /* ── presets ───────────────────────────────────────────────────────────── */

  const PRESETS = {
    classic: {
      label: '经典 DSH',
      desc: 'Logo + 标语 + 输入框',
      rows: 18,
      items: [
        { type: 'dsh-logo', x: 10, y: 2 },
        { type: 'tagline', x: 7, y: 7 },
        { type: 'composer', x: 4, y: 10 },
      ],
    },
    plan: {
      label: '现行规划',
      desc: '工作区 / 用量 / 入口',
      rows: 29,
      items: [
        { type: 'dsh-logo', x: 10, y: 1 },
        { type: 'tagline', x: 7, y: 6 },
        { type: 'composer', x: 4, y: 9 },
        { type: 'section-label', x: 1, y: 13 },
        { type: 'workspace-card', x: 1, y: 14 },
        { type: 'workspace-card', x: 9, y: 14 },
        { type: 'workspace-card', x: 17, y: 14 },
        { type: 'section-label', x: 1, y: 17, variant: 1 },
        { type: 'usage-deepseek', x: 1, y: 18 },
        { type: 'usage-minimax', x: 9, y: 18 },
        { type: 'usage-cline', x: 17, y: 18 },
        { type: 'section-label', x: 1, y: 21, variant: 2 },
        { type: 'link-card', x: 1, y: 22 },
        { type: 'link-card', x: 9, y: 22 },
        { type: 'link-card', x: 17, y: 22 },
        { type: 'settings-entry', x: 9, y: 25 },
      ],
    },
    pad: {
      label: 'Pad 工作台',
      desc: '时钟 / 日历 / 待办',
      rows: 19,
      items: [
        { type: 'pad-clock', x: 1, y: 2 },
        { type: 'pad-weather', x: 7, y: 2 },
        { type: 'pad-calendar', x: 16, y: 2 },
        { type: 'pad-todo', x: 1, y: 6 },
        { type: 'pad-photo', x: 9, y: 6 },
        { type: 'pad-battery', x: 1, y: 11 },
        { type: 'pad-music', x: 7, y: 11 },
        { type: 'pad-voice', x: 1, y: 14 },
        { type: 'composer', x: 7, y: 14 },
      ],
    },
    pc: {
      label: 'PC 工作台',
      desc: '监控 / Git / 终端',
      rows: 17,
      items: [
        { type: 'pc-system', x: 1, y: 2 },
        { type: 'pc-git', x: 9, y: 2 },
        { type: 'pc-pr', x: 16, y: 2 },
        { type: 'pc-terminal', x: 1, y: 6 },
        { type: 'pc-rss', x: 11, y: 6 },
        { type: 'pc-launcher', x: 1, y: 10 },
        { type: 'composer', x: 11, y: 11, w: 12 },
      ],
    },
    blank: {
      label: '空白画布',
      desc: '从零开始',
      rows: 18,
      items: [],
    },
  }

  /* ── catalog ───────────────────────────────────────────────────────────── */

  const baseList = Array.isArray(window.DSH_WIDGETS_BASE_PLAN) ? window.DSH_WIDGETS_BASE_PLAN : []
  const padpcList = Array.isArray(window.DSH_WIDGETS_PAD_PC) ? window.DSH_WIDGETS_PAD_PC : []
  const composerWidget = window.DSH_COMPOSER_WIDGET || null

  const baseWidgets = baseList.filter((w) => w && w.category === 'base')
  if (composerWidget) baseWidgets.splice(Math.min(2, baseWidgets.length), 0, composerWidget)
  const CATALOG = [
    ...baseWidgets,
    ...baseList.filter((w) => w && w.category === 'plan'),
    ...padpcList.filter((w) => w && w.category === 'pad'),
    ...padpcList.filter((w) => w && w.category === 'pc'),
  ].filter((w, index, all) => w && w.id && all.findIndex((x) => x.id === w.id) === index)

  const BY_ID = new Map(CATALOG.map((w) => [w.id, w]))

  /* ── dom ───────────────────────────────────────────────────────────────── */

  const $ = (sel, root) => (root || document).querySelector(sel)
  const app = $('#app')
  const sidebar = $('#sidebar')
  const workspace = $('#workspace')
  const stage = $('#stage')
  const canvasScroll = $('#canvas-scroll')
  const canvas = $('#canvas')
  const widgetsLayer = $('#widgets-layer')
  const dropPreview = $('#drop-preview')
  const dropPreviewLabel = $('#drop-preview-label')
  const emptyState = $('#empty-state')
  const toolbar = $('#toolbar')
  const paletteEl = $('#palette')
  const paletteSearch = $('#palette-search')
  const paletteTabs = $('#palette-tabs')
  const paletteCount = $('#palette-count')
  const presetMenu = $('#preset-menu')
  const moreMenu = $('#more-menu')
  const dragGhost = $('#drag-ghost')
  const dgName = $('#dg-name')
  const dgSize = $('#dg-size')
  const dgHint = $('#dg-hint')
  const inspector = $('#inspector')
  const inspName = $('#insp-name')
  const inspSize = $('#insp-size')
  const inspWidthRow = $('#insp-width-row')
  const inspWidth = $('#insp-width')
  const inspWidthVal = $('#insp-width-val')
  const toastEl = $('#toast')
  const presetLabel = $('#preset-label')

  /* ── state ─────────────────────────────────────────────────────────────── */

  const state = {
    theme: 'dark',
    sidebar: 'open',
    drawer: 'open',
    grid: 'on',
    widgets: [],
    rows: MIN_ROWS,
    selected: null,
    preset: 'classic',
    activeCat: 'all',
    query: '',
  }

  let cell = 28
  let rowH = ROW_H
  let stepX = 34
  let stepY = 36
  let uidSeed = 0
  let toastTimer = 0
  let saveTimer = 0
  let openMenuEl = null
  let paletteDrag = null
  let persistEnabled = true

  const widgetEls = new Map()
  const cleanups = new Map()

  let history = []
  let historyIndex = -1

  /* ── small utilities ───────────────────────────────────────────────────── */

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
  const round = Math.round
  const nextUid = () => `w-${(++uidSeed).toString(36)}-${Date.now().toString(36).slice(-4)}`
  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const deepCopy = (value) => JSON.parse(JSON.stringify(value))
  const getSelected = () => state.widgets.find((w) => w.uid === state.selected) || null
  const getDef = (entry) => (entry ? BY_ID.get(entry.type) : null)

  function toast(message) {
    toastEl.textContent = message
    toastEl.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200)
  }

  /* ── geometry ──────────────────────────────────────────────────────────── */

  function measure() {
    const width = canvas.clientWidth
    if (!width) return false
    cell = Math.max(12, (width - GAP * (COLS - 1)) / COLS)
    rowH = ROW_H
    stepX = cell + GAP
    stepY = rowH + GAP
    canvas.style.setProperty('--cell', `${cell}px`)
    canvas.style.setProperty('--row', `${rowH}px`)
    canvas.style.setProperty('--step-x', `${stepX}px`)
    canvas.style.setProperty('--step-y', `${stepY}px`)
    return true
  }

  function requiredRows() {
    let bottom = 0
    for (const entry of state.widgets) bottom = Math.max(bottom, entry.y + entry.h)
    return Math.max(MIN_ROWS, bottom + 2)
  }

  function applyCanvasHeight() {
    canvas.style.height = `${state.rows * stepY - GAP}px`
  }

  function geometryFor(rect) {
    return {
      left: round(rect.x * stepX),
      top: round(rect.y * stepY),
      width: round(rect.w * cell + (rect.w - 1) * GAP),
      height: round(rect.h * rowH + (rect.h - 1) * GAP),
    }
  }

  function placeEl(el, entry) {
    if (!el) return
    const g = geometryFor(entry)
    el.style.transform = `translate3d(${g.left}px, ${g.top}px, 0)`
    el.style.width = `${g.width}px`
    el.style.height = `${g.height}px`
    updateWidgetChrome(el, entry)
  }

  function updateWidgetChrome(el, entry) {
    const badge = el.querySelector('.wc-size')
    if (badge) badge.textContent = `${entry.w} × ${entry.h}`
  }

  function layoutAll() {
    if (!measure()) return
    state.rows = requiredRows()
    applyCanvasHeight()
    for (const entry of state.widgets) placeEl(widgetEls.get(entry.uid), entry)
    if (state.selected) updateInspector()
  }

  /* ── collision / placement ─────────────────────────────────────────────── */

  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  function canPlace(rect, ignoreUid) {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > COLS) return false
    for (const entry of state.widgets) {
      if (ignoreUid && entry.uid === ignoreUid) continue
      if (overlaps(rect, entry)) return false
    }
    return true
  }

  function canPlaceIn(list, rect) {
    for (const entry of list) if (overlaps(rect, entry)) return false
    return true
  }

  function findFreeSpot(w, h, hintX, hintY, ignoreUid) {
    const maxY = Math.max(state.rows, hintY + h) + 4
    let best = null
    let bestDist = Infinity
    for (let y = 0; y <= maxY; y++) {
      for (let x = 0; x <= COLS - w; x++) {
        if (!canPlace({ x, y, w, h }, ignoreUid)) continue
        const dist = (x - hintX) ** 2 + (y - hintY) ** 2
        if (dist < bestDist) {
          bestDist = dist
          best = { x, y, w, h, exact: false }
          if (dist === 0) return best
        }
      }
    }
    return best
  }

  function resolveSpot(w, h, hintX, hintY, ignoreUid) {
    const x = clamp(round(hintX), 0, Math.max(0, COLS - w))
    const y = Math.max(0, round(hintY))
    if (canPlace({ x, y, w, h }, ignoreUid)) return { x, y, w, h, exact: true }
    return findFreeSpot(w, h, x, y, ignoreUid)
  }

  /* ── render widgets ────────────────────────────────────────────────────── */

  function cleanupWidget(uid) {
    const cleanup = cleanups.get(uid)
    if (typeof cleanup === 'function') {
      try { cleanup() } catch (error) { console.warn('widget cleanup failed', error) }
    }
    cleanups.delete(uid)
  }

  function renderWidgets() {
    for (const uid of cleanups.keys()) cleanupWidget(uid)
    widgetEls.clear()
    widgetsLayer.textContent = ''

    for (const entry of state.widgets) mountWidget(entry)

    if (state.selected && !state.widgets.some((w) => w.uid === state.selected)) state.selected = null
    updateEmptyState()
    updateInspector()
    layoutAll()
  }

  function mountWidget(entry) {
    const def = getDef(entry)
    if (!def) return

    const el = document.createElement('div')
    el.className = 'widget'
    el.dataset.uid = entry.uid
    el.dataset.type = entry.type
    el.dataset.selected = String(entry.uid === state.selected)

    const inner = document.createElement('div')
    inner.className = 'widget-inner'
    let html = ''
    try {
      html = def.render({ uid: entry.uid, variant: entry.variant || 0, theme: state.theme, now: new Date() }) || ''
    } catch (error) {
      console.error(`[prototype] render failed: ${def.id}`, error)
      html = `<div class="w w-card" style="align-items:center;justify-content:center;color:var(--tx-3);font-size:11px">组件渲染失败</div>`
    }
    inner.innerHTML = html

    const chrome = document.createElement('div')
    chrome.className = 'widget-chrome'
    chrome.innerHTML = `<span class="wc-name">${escapeHtml(def.name)}</span><span class="wc-size">${entry.w} × ${entry.h}</span>`

    el.appendChild(inner)
    el.appendChild(chrome)
    for (const dir of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
      const handle = document.createElement('div')
      handle.className = `rh rh-${dir}`
      handle.dataset.resize = dir
      el.appendChild(handle)
    }

    el.addEventListener('pointerdown', (event) => onWidgetPointerDown(event, entry))
    widgetsLayer.appendChild(el)
    widgetEls.set(entry.uid, el)
    placeEl(el, entry)

    if (typeof def.mount === 'function') {
      try {
        const cleanup = def.mount(inner, { uid: entry.uid, variant: entry.variant || 0, theme: state.theme, now: new Date() })
        if (typeof cleanup === 'function') cleanups.set(entry.uid, cleanup)
      } catch (error) {
        console.error(`[prototype] mount failed: ${def.id}`, error)
      }
    }
  }

  function updateEmptyState() {
    emptyState.hidden = state.widgets.length > 0
  }

  /* ── selection / inspector ─────────────────────────────────────────────── */

  function select(uid) {
    if (state.selected === uid) return
    state.selected = uid
    for (const [id, el] of widgetEls) el.dataset.selected = String(id === uid)
    updateInspector()
  }

  function deselect() {
    select(null)
  }

  function updateInspector() {
    const entry = getSelected()
    if (!entry) {
      inspector.hidden = true
      return
    }
    const def = getDef(entry)
    inspector.hidden = false
    inspName.textContent = def ? def.name : entry.type
    inspSize.textContent = `${entry.w} × ${entry.h}`

    const showWidth = entry.type === 'composer' && def
    inspWidthRow.hidden = !showWidth
    if (showWidth) {
      const minW = Math.max(1, def.minW || 1)
      const maxW = Math.min(COLS, def.maxW || COLS)
      inspWidth.min = String(minW)
      inspWidth.max = String(maxW)
      inspWidth.value = String(entry.w)
      inspWidthVal.textContent = `${entry.w} 格`
    }
  }

  /* ── add / delete / duplicate ──────────────────────────────────────────── */

  function variantCount(type) {
    return state.widgets.filter((w) => w.type === type).length
  }

  function addWidget(def, x, y, overrideW, overrideH) {
    const maxW = Math.min(COLS, def.maxW || COLS)
    const w = clamp(overrideW || def.w || 4, def.minW || 1, maxW)
    const h = clamp(overrideH || def.h || 2, def.minH || 1, def.maxH || 40)
    const spot = resolveSpot(w, h, x, y)
    if (!spot) {
      toast('画布没有空位了')
      return null
    }
    const entry = {
      uid: nextUid(),
      type: def.id,
      x: spot.x,
      y: spot.y,
      w: spot.w,
      h: spot.h,
      variant: variantCount(def.id),
    }
    state.widgets.push(entry)
    state.preset = 'custom'
    state.selected = entry.uid
    renderWidgets()
    updatePresetLabel()
    pushHistory()
    scheduleSave()
    const el = widgetEls.get(entry.uid)
    if (el) {
      el.classList.add('is-new')
      setTimeout(() => el.classList.remove('is-new'), 240)
    }
    toast(`已添加「${def.name}」`)
    return entry
  }

  function addFromPalette(def) {
    const w = Math.min(COLS, def.w || 4)
    const h = def.h || 2
    const view = canvasScroll.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const centerY = view.top + view.height * 0.42
    const hintY = Math.max(0, round((centerY - canvasRect.top) / stepY - h / 2))
    const hintX = round((COLS - w) / 2)
    addWidget(def, hintX, hintY)
  }

  function deleteWidget(uid) {
    const index = state.widgets.findIndex((w) => w.uid === uid)
    if (index < 0) return
    const def = getDef(state.widgets[index])
    state.widgets.splice(index, 1)
    cleanupWidget(uid)
    widgetEls.delete(uid)
    if (state.selected === uid) state.selected = null
    state.preset = 'custom'
    state.rows = requiredRows()
    renderWidgets()
    updatePresetLabel()
    pushHistory()
    scheduleSave()
    toast(def ? `已删除「${def.name}」` : '已删除组件')
  }

  function duplicateWidget(uid) {
    const entry = state.widgets.find((w) => w.uid === uid)
    if (!entry) return
    const def = getDef(entry)
    if (!def) return
    const spot = findFreeSpot(entry.w, entry.h, entry.x + 1, entry.y, entry.uid)
    if (!spot) {
      toast('周边没有空位，先挪一挪')
      return
    }
    const copy = {
      uid: nextUid(),
      type: entry.type,
      x: spot.x,
      y: spot.y,
      w: entry.w,
      h: entry.h,
      variant: variantCount(entry.type),
    }
    state.widgets.push(copy)
    state.selected = copy.uid
    state.preset = 'custom'
    renderWidgets()
    updatePresetLabel()
    pushHistory()
    scheduleSave()
    toast(`已复制「${def.name}」`)
  }

  function resizeWidth(entry, nextW, commit) {
    const def = getDef(entry)
    if (!def) return
    const minW = Math.max(1, def.minW || 1)
    const maxW = Math.min(COLS, def.maxW || COLS)
    const w = clamp(round(nextW), minW, maxW)
    const x = clamp(entry.x, 0, COLS - w)
    const spot = resolveSpot(w, entry.h, x, entry.y, entry.uid)
    if (!spot) return
    entry.x = spot.x
    entry.y = spot.y
    entry.w = spot.w
    placeEl(widgetEls.get(entry.uid), entry)
    state.preset = 'custom'
    updatePresetLabel()
    updateInspector()
    if (commit !== false) {
      pushHistory()
      scheduleSave()
    }
  }

  /* ── history ───────────────────────────────────────────────────────────── */

  function snapshot() {
    return {
      widgets: deepCopy(state.widgets),
      rows: state.rows,
      preset: state.preset,
    }
  }

  function updateHistoryButtons() {
    $('#btn-undo').disabled = historyIndex <= 0
    $('#btn-redo').disabled = historyIndex >= history.length - 1
  }

  function pushHistory() {
    const snap = snapshot()
    const current = history[historyIndex]
    if (current && JSON.stringify(current) === JSON.stringify(snap)) return
    history = history.slice(0, historyIndex + 1)
    history.push(snap)
    if (history.length > 80) history.shift()
    historyIndex = history.length - 1
    updateHistoryButtons()
  }

  function resetHistory() {
    history = [snapshot()]
    historyIndex = 0
    updateHistoryButtons()
  }

  function applySnapshot(snap) {
    state.widgets = deepCopy(snap.widgets)
    state.rows = snap.rows || requiredRows()
    state.preset = snap.preset || 'custom'
    state.selected = null
    renderWidgets()
    updatePresetLabel()
    updateHistoryButtons()
    scheduleSave()
  }

  function undo() {
    if (historyIndex <= 0) return
    historyIndex -= 1
    applySnapshot(history[historyIndex])
    toast('已撤销')
  }

  function redo() {
    if (historyIndex >= history.length - 1) return
    historyIndex += 1
    applySnapshot(history[historyIndex])
    toast('已重做')
  }

  /* ── presets ───────────────────────────────────────────────────────────── */

  function buildPreset(key) {
    const preset = PRESETS[key]
    if (!preset) return null
    const widgets = []
    const counts = {}
    for (const item of preset.items || []) {
      const def = BY_ID.get(item.type)
      if (!def) continue
      const w = clamp(item.w || def.w || 4, def.minW || 1, Math.min(COLS, def.maxW || COLS))
      const h = clamp(item.h || def.h || 2, def.minH || 1, def.maxH || 40)
      const x = clamp(item.x || 0, 0, COLS - w)
      const y = Math.max(0, item.y || 0)
      if (x + w > COLS) continue
      if (!canPlaceIn(widgets, { x, y, w, h })) continue
      counts[item.type] = (counts[item.type] || 0) + 1
      widgets.push({
        uid: nextUid(),
        type: def.id,
        x,
        y,
        w,
        h,
        variant: item.variant !== undefined ? item.variant : counts[item.type] - 1,
      })
    }
    let bottom = 0
    for (const entry of widgets) bottom = Math.max(bottom, entry.y + entry.h)
    return {
      widgets,
      rows: Math.max(MIN_ROWS, preset.rows || 0, bottom + 2),
      preset: key,
    }
  }

  function applyPreset(key, options) {
    const opts = options || {}
    const built = buildPreset(key)
    if (!built) return
    state.widgets = built.widgets
    state.rows = built.rows
    state.preset = key
    state.selected = null
    renderWidgets()
    updatePresetLabel()
    if (!opts.initial) {
      pushHistory()
      scheduleSave()
      toast(`已载入「${PRESETS[key].label}」`)
    }
  }

  function updatePresetLabel() {
    const preset = PRESETS[state.preset]
    presetLabel.textContent = preset ? preset.label : '自定义布局'
  }

  /* ── persistence ───────────────────────────────────────────────────────── */

  function scheduleSave() {
    if (!persistEnabled) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 260)
  }

  function saveNow() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          version: 1,
          theme: state.theme,
          sidebar: state.sidebar,
          drawer: state.drawer,
          grid: state.grid,
          preset: state.preset,
          rows: state.rows,
          widgets: state.widgets,
        })
      )
    } catch (error) {
      /* file:// or private mode — prototype still works, just no persistence */
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || data.version !== 1) return null
      const widgets = (Array.isArray(data.widgets) ? data.widgets : [])
        .filter((entry) => entry && BY_ID.has(entry.type))
        .map((entry) => {
          const def = BY_ID.get(entry.type)
          const w = clamp(Number(entry.w) || def.w || 4, 1, COLS)
          const h = clamp(Number(entry.h) || def.h || 2, 1, 40)
          return {
            uid: typeof entry.uid === 'string' ? entry.uid : nextUid(),
            type: entry.type,
            x: clamp(Number(entry.x) || 0, 0, COLS - w),
            y: Math.max(0, Number(entry.y) || 0),
            w,
            h,
            variant: Number(entry.variant) || 0,
          }
        })
      return {
        theme: data.theme === 'light' ? 'light' : 'dark',
        sidebar: data.sidebar === 'closed' ? 'closed' : 'open',
        drawer: data.drawer === 'closed' ? 'closed' : 'open',
        grid: data.grid === 'off' ? 'off' : 'on',
        preset: PRESETS[data.preset] ? data.preset : 'custom',
        rows: Math.max(MIN_ROWS, Number(data.rows) || MIN_ROWS),
        widgets,
      }
    } catch (error) {
      return null
    }
  }

  /* ── chrome (theme / sidebar / drawer / grid) ──────────────────────────── */

  function applyThemeIcon() {
    const button = $('#btn-theme')
    const toLight = state.theme === 'dark'
    button.innerHTML = `<svg class="icon"><use href="#i-${toLight ? 'sun' : 'moon'}"/></svg>`
    button.title = toLight ? '切换到浅色（T）' : '切换到深色（T）'
    button.setAttribute('aria-label', toLight ? '切换到浅色' : '切换到深色')
  }

  function setTheme(theme, options) {
    const opts = options || {}
    state.theme = theme === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.theme = state.theme
    applyThemeIcon()
    renderWidgets()
    buildPalette()
    if (!opts.initial) {
      scheduleSave()
      toast(state.theme === 'dark' ? '已切换到深色' : '已切换到浅色')
    }
  }

  function setSidebar(open, options) {
    const opts = options || {}
    state.sidebar = open ? 'open' : 'closed'
    app.dataset.sidebar = state.sidebar
    $('#btn-sidebar').classList.toggle('is-on', open)
    $('#sidebar').setAttribute('aria-hidden', String(!open))
    if (!opts.initial) {
      scheduleSave()
      requestAnimationFrame(() => requestAnimationFrame(layoutAll))
      setTimeout(layoutAll, 320)
    }
  }

  function setDrawer(open, options) {
    const opts = options || {}
    state.drawer = open ? 'open' : 'closed'
    app.dataset.drawer = state.drawer
    $('#btn-drawer').classList.toggle('is-on', open)
    $('#drawer').setAttribute('aria-hidden', String(!open))
    if (!opts.initial) {
      // 右侧抽屉是浮层：不参与画布宽度/布局计算，只重置横向浏览位置。
      canvasScroll.scrollLeft = 0
      requestAnimationFrame(() => { canvasScroll.scrollLeft = 0 })
      scheduleSave()
    }
  }

  function setGrid(on, options) {
    const opts = options || {}
    state.grid = on ? 'on' : 'off'
    app.dataset.grid = state.grid
    $('#btn-grid').classList.toggle('is-on', on)
    if (!opts.initial) scheduleSave()
  }

  function applyInitialChrome() {
    document.documentElement.dataset.theme = state.theme
    applyThemeIcon()
    app.dataset.sidebar = state.sidebar
    app.dataset.drawer = state.drawer
    app.dataset.grid = state.grid
    $('#btn-sidebar').classList.toggle('is-on', state.sidebar === 'open')
    $('#btn-drawer').classList.toggle('is-on', state.drawer === 'open')
    $('#drawer').setAttribute('aria-hidden', String(state.drawer !== 'open'))
    $('#btn-grid').classList.toggle('is-on', state.grid === 'on')
    $('#sidebar').setAttribute('aria-hidden', String(state.sidebar !== 'open'))
    updatePresetLabel()
  }

  /* ── palette ───────────────────────────────────────────────────────────── */

  function filteredCatalog() {
    const query = state.query.trim().toLowerCase()
    return CATALOG.filter((def) => {
      if (state.activeCat !== 'all' && def.category !== state.activeCat) return false
      if (!query) return true
      return `${def.name} ${def.desc || ''} ${def.id} ${def.category}`.toLowerCase().includes(query)
    })
  }

  function buildPalette() {
    const list = filteredCatalog()
    const grouped = new Map()
    for (const def of list) {
      if (!grouped.has(def.category)) grouped.set(def.category, [])
      grouped.get(def.category).push(def)
    }

    paletteEl.textContent = ''
    paletteCount.textContent = String(list.length)

    if (!list.length) {
      const empty = document.createElement('div')
      empty.className = 'pal-empty'
      empty.textContent = state.query ? `没有找到「${state.query}」` : '这个分类暂时没有组件'
      paletteEl.appendChild(empty)
      return
    }

    for (const category of CAT_ORDER) {
      const defs = grouped.get(category)
      if (!defs || !defs.length) continue
      const section = document.createElement('div')
      section.className = 'pal-section'
      section.innerHTML = `<span>${CAT_LABEL[category]}</span><em>${CAT_HINT[category] || ''}</em><i></i>`
      paletteEl.appendChild(section)
      for (const def of defs) paletteEl.appendChild(createPaletteItem(def))
    }
  }

  function createPaletteItem(def) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'pal-item'
    item.dataset.id = def.id
    item.title = `${def.name} · ${def.desc || ''}\n拖入画布，或点击直接添加`

    const thumb = document.createElement('span')
    thumb.className = 'pal-thumb'
    const thumbInner = document.createElement('span')
    thumbInner.className = 'pal-thumb-inner'

    const previewW = Math.min(COLS, def.w || 4)
    const previewH = def.h || 2
    const pCell = 20
    const pGap = 3
    const naturalW = previewW * pCell + (previewW - 1) * pGap
    const naturalH = previewH * pCell + (previewH - 1) * pGap
    const scale = Math.min(96 / naturalW, 54 / naturalH, 1)

    const mini = document.createElement('div')
    mini.className = 'widget-inner'
    mini.style.width = `${naturalW}px`
    mini.style.height = `${naturalH}px`
    try {
      mini.innerHTML = def.render({ uid: `preview-${def.id}`, variant: 0, theme: state.theme, now: new Date() }) || ''
    } catch (error) {
      mini.innerHTML = ''
    }
    thumbInner.style.width = `${naturalW}px`
    thumbInner.style.height = `${naturalH}px`
    thumbInner.style.transform = `scale(${scale})`
    thumbInner.style.left = `${(104 - naturalW * scale) / 2}px`
    thumbInner.style.top = `${(62 - naturalH * scale) / 2}px`
    thumbInner.appendChild(mini)
    thumb.appendChild(thumbInner)

    const info = document.createElement('span')
    info.className = 'pal-info'
    info.innerHTML = `
      <span class="pal-name-row">
        <span class="pal-name">${escapeHtml(def.name)}</span>
        <span class="pal-size">${def.w || 4}×${def.h || 2}</span>
      </span>
      <span class="pal-desc">${escapeHtml(def.desc || '')}</span>`

    item.appendChild(thumb)
    item.appendChild(info)
    item.addEventListener('pointerdown', (event) => beginPalettePress(event, def, item))
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        addFromPalette(def)
      }
    })
    return item
  }

  /* ── palette drag & drop ───────────────────────────────────────────────── */

  function beginPalettePress(event, def, item) {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    let active = false

    const onMove = (moveEvent) => {
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return
        active = true
        paletteDrag = { def, item, preview: null }
        item.classList.add('is-leaving')
        document.body.classList.add('is-dragging')
        dragGhost.hidden = false
        dgName.textContent = def.name
        dgSize.textContent = `${def.w || 4} × ${def.h || 2}`
        dgHint.textContent = '拖到画布放置'
      }
      if (moveEvent.cancelable) moveEvent.preventDefault()
      movePaletteGhost(moveEvent)
    }

    const finish = (upEvent, cancelled) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      item.classList.remove('is-leaving')
      document.body.classList.remove('is-dragging')
      dragGhost.hidden = true
      hideDropPreview()
      const drag = paletteDrag
      paletteDrag = null
      if (!active) {
        if (!cancelled) addFromPalette(def)
        return
      }
      if (cancelled) return
      if (drag && drag.preview) {
        addWidget(def, drag.preview.x, drag.preview.y)
      } else {
        toast('拖到画布空白处再松手')
      }
      void upEvent
    }

    const onUp = (upEvent) => finish(upEvent, false)
    const onCancel = (upEvent) => finish(upEvent, true)

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function movePaletteGhost(event) {
    if (!paletteDrag) return
    const def = paletteDrag.def
    dragGhost.style.left = `${event.clientX}px`
    dragGhost.style.top = `${event.clientY}px`

    const rect = canvas.getBoundingClientRect()
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    dragGhost.classList.toggle('is-over', inside)

    if (!inside) {
      paletteDrag.preview = null
      hideDropPreview()
      dragGhost.classList.remove('is-invalid')
      dgHint.textContent = '拖到画布放置'
      return
    }

    const w = Math.min(COLS, def.w || 4)
    const h = def.h || 2
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const hintX = round((localX - (w * cell + (w - 1) * GAP) / 2) / stepX)
    const hintY = round((localY - (h * rowH + (h - 1) * GAP) / 2) / stepY)
    const spot = resolveSpot(w, h, hintX, hintY)

    if (!spot) {
      paletteDrag.preview = null
      dragGhost.classList.add('is-invalid')
      dgHint.textContent = '没有空位'
      showDropPreview({ x: clamp(hintX, 0, COLS - w), y: Math.max(0, hintY), w, h }, false)
      return
    }

    paletteDrag.preview = spot
    dragGhost.classList.remove('is-invalid')
    dgHint.textContent = spot.exact ? '松开放置' : '放在最近空位'
    showDropPreview(spot, true)
  }

  function showDropPreview(rect, valid) {
    const g = geometryFor(rect)
    dropPreview.hidden = false
    dropPreview.classList.toggle('invalid', !valid)
    dropPreview.style.transform = `translate3d(${g.left}px, ${g.top}px, 0)`
    dropPreview.style.width = `${g.width}px`
    dropPreview.style.height = `${g.height}px`
    dropPreviewLabel.textContent = `${rect.w} × ${rect.h}${rect.exact === false ? ' · 最近空位' : ''}`
  }

  function hideDropPreview() {
    dropPreview.hidden = true
    dropPreview.classList.remove('invalid')
  }

  /* ── move / resize on canvas ───────────────────────────────────────────── */

  function onWidgetPointerDown(event, entry) {
    if (event.button !== 0) return
    const handle = event.target.closest('[data-resize]')
    if (handle) {
      event.preventDefault()
      event.stopPropagation()
      select(entry.uid)
      startResize(event, entry, handle.dataset.resize)
      return
    }
    select(entry.uid)
    const interactive = event.target.closest(
      '[data-nodrag], input, textarea, select, button, a, label, summary, [contenteditable="true"]'
    )
    if (interactive) return
    startMove(event, entry)
  }

  function startMove(event, entry) {
    const el = widgetEls.get(entry.uid)
    if (!el) return
    const startX = event.clientX
    const startY = event.clientY
    const origin = { x: entry.x, y: entry.y }
    let moved = false
    let lastX = origin.x
    let lastY = origin.y

    const onMove = (moveEvent) => {
      const dx = round((moveEvent.clientX - startX) / stepX)
      const dy = round((moveEvent.clientY - startY) / stepY)
      if (!moved && dx === 0 && dy === 0) return
      if (!moved) {
        moved = true
        el.classList.add('is-dragging')
        document.body.classList.add('is-dragging')
      }
      const nx = clamp(origin.x + dx, 0, COLS - entry.w)
      const ny = Math.max(0, origin.y + dy)
      if (canPlace({ x: nx, y: ny, w: entry.w, h: entry.h }, entry.uid)) {
        entry.x = nx
        entry.y = ny
        lastX = nx
        lastY = ny
        placeEl(el, entry)
        el.classList.remove('is-invalid')
        updateInspector()
      } else {
        el.classList.add('is-invalid')
      }
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.classList.remove('is-dragging', 'is-invalid')
      document.body.classList.remove('is-dragging')
      if (moved && (lastX !== origin.x || lastY !== origin.y)) {
        state.preset = 'custom'
        updatePresetLabel()
        state.rows = requiredRows()
        applyCanvasHeight()
        layoutAll()
        pushHistory()
        scheduleSave()
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function startResize(event, entry, direction) {
    const el = widgetEls.get(entry.uid)
    const def = getDef(entry)
    if (!el || !def) return
    const startX = event.clientX
    const startY = event.clientY
    const origin = { x: entry.x, y: entry.y, w: entry.w, h: entry.h }
    const minW = Math.max(1, def.minW || 1)
    const minH = Math.max(1, def.minH || 1)
    const maxW = Math.min(COLS, def.maxW || COLS)
    const maxH = def.maxH || 40
    let changed = false

    const onMove = (moveEvent) => {
      const dx = round((moveEvent.clientX - startX) / stepX)
      const dy = round((moveEvent.clientY - startY) / stepY)
      let x = origin.x
      let y = origin.y
      let w = origin.w
      let h = origin.h

      if (direction.includes('e')) w = origin.w + dx
      if (direction.includes('s')) h = origin.h + dy
      if (direction.includes('w')) {
        w = origin.w - dx
        x = origin.x + dx
      }
      if (direction.includes('n')) {
        h = origin.h - dy
        y = origin.y + dy
      }

      w = clamp(w, minW, maxW)
      h = clamp(h, minH, maxH)
      if (direction.includes('w')) x = clamp(x, 0, origin.x + origin.w - w)
      if (direction.includes('n')) y = Math.max(0, Math.min(y, origin.y + origin.h - h))
      x = clamp(x, 0, COLS - w)

      if (canPlace({ x, y, w, h }, entry.uid)) {
        entry.x = x
        entry.y = y
        entry.w = w
        entry.h = h
        changed = true
        placeEl(el, entry)
        el.classList.remove('is-invalid')
        updateInspector()
      } else {
        el.classList.add('is-invalid')
      }
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.classList.remove('is-invalid')
      if (changed) {
        state.preset = 'custom'
        updatePresetLabel()
        state.rows = requiredRows()
        applyCanvasHeight()
        layoutAll()
        pushHistory()
        scheduleSave()
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /* ── floating menus ────────────────────────────────────────────────────── */

  function closeMenus() {
    if (!openMenuEl) return
    openMenuEl.hidden = true
    openMenuEl = null
  }

  function openFloatingMenu(menu, anchor) {
    closeMenus()
    menu.hidden = false
    openMenuEl = menu
    const rect = anchor.getBoundingClientRect()
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    let left = rect.right - width
    let top = rect.bottom + 6
    if (left < 8) left = 8
    if (top + height > window.innerHeight - 8) top = rect.top - height - 6
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  function buildPresetMenu() {
    const entries = Object.entries(PRESETS)
      .map(
        ([key, preset]) => `
        <button type="button" class="menu-item${state.preset === key ? ' is-active' : ''}" data-preset="${key}">
          <svg class="icon"><use href="#i-layout"/></svg>
          <span>${preset.label}</span>
          <span class="mi-desc">${preset.desc}</span>
        </button>`
      )
      .join('')
    presetMenu.innerHTML = `<div class="menu-label">布局预设</div>${entries}`
  }

  function buildMoreMenu() {
    moreMenu.innerHTML = `
      <div class="menu-label">布局</div>
      <button type="button" class="menu-item" data-action="export"><svg class="icon"><use href="#i-download"/></svg><span>导出布局 JSON</span></button>
      <button type="button" class="menu-item" data-action="copy"><svg class="icon"><use href="#i-copy"/></svg><span>复制布局 JSON</span></button>
      <div class="menu-sep"></div>
      <button type="button" class="menu-item" data-action="reset"><svg class="icon"><use href="#i-reset"/></svg><span>恢复经典 DSH 布局</span></button>
      <button type="button" class="menu-item" data-action="clear"><svg class="icon"><use href="#i-trash"/></svg><span>清空画布</span></button>`
  }

  function layoutPayload() {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      cols: COLS,
      rows: state.rows,
      theme: state.theme,
      preset: state.preset,
      widgets: state.widgets.map(({ type, x, y, w, h, variant }) => ({ type, x, y, w, h, variant })),
    }
  }

  function exportLayout() {
    const payload = layoutPayload()
    const text = JSON.stringify(payload, null, 2)
    try {
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'dsh-home-layout.json'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('布局 JSON 已导出')
    } catch (error) {
      toast('导出失败，请用「复制布局 JSON」')
    }
  }

  async function copyLayout() {
    const text = JSON.stringify(layoutPayload(), null, 2)
    try {
      await navigator.clipboard.writeText(text)
      toast('布局 JSON 已复制')
    } catch (error) {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
        toast('布局 JSON 已复制')
      } catch (copyError) {
        toast('复制失败')
      }
      area.remove()
    }
  }

  /* ── keyboard ──────────────────────────────────────────────────────────── */

  function isTypingTarget(target) {
    if (!target || !(target instanceof Element)) return false
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }

  function moveSelected(dx, dy) {
    const entry = getSelected()
    if (!entry) return
    const nx = clamp(entry.x + dx, 0, COLS - entry.w)
    const ny = Math.max(0, entry.y + dy)
    if (nx === entry.x && ny === entry.y) return
    if (!canPlace({ x: nx, y: ny, w: entry.w, h: entry.h }, entry.uid)) return
    entry.x = nx
    entry.y = ny
    placeEl(widgetEls.get(entry.uid), entry)
    state.preset = 'custom'
    updatePresetLabel()
    state.rows = requiredRows()
    applyCanvasHeight()
    pushHistory()
    scheduleSave()
    updateInspector()
  }

  function onKeyDown(event) {
    if (isTypingTarget(event.target)) return
    const mod = event.metaKey || event.ctrlKey

    if (mod && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (mod && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault()
      if (state.selected) duplicateWidget(state.selected)
      return
    }
    if (mod && (event.key === 's' || event.key === 'S')) {
      event.preventDefault()
      exportLayout()
      return
    }

    if (!mod) {
      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          if (state.selected) {
            event.preventDefault()
            deleteWidget(state.selected)
          }
          break
        case 'Escape':
          closeMenus()
          deselect()
          break
        case 'ArrowLeft':
          if (state.selected) {
            event.preventDefault()
            moveSelected(-1, 0)
          }
          break
        case 'ArrowRight':
          if (state.selected) {
            event.preventDefault()
            moveSelected(1, 0)
          }
          break
        case 'ArrowUp':
          if (state.selected) {
            event.preventDefault()
            moveSelected(0, -1)
          }
          break
        case 'ArrowDown':
          if (state.selected) {
            event.preventDefault()
            moveSelected(0, 1)
          }
          break
        case 's':
        case 'S':
          setSidebar(state.sidebar !== 'open')
          break
        case 't':
        case 'T':
          setTheme(state.theme === 'dark' ? 'light' : 'dark')
          break
        case 'g':
        case 'G':
          setGrid(state.grid !== 'on')
          break
        case 'd':
        case 'D':
          setDrawer(state.drawer !== 'open')
          break
        default:
          break
      }
    }
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */

  function wireToolbar() {
    $('#btn-sidebar').addEventListener('click', () => setSidebar(state.sidebar !== 'open'))
    $('#btn-theme').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'))
    $('#btn-grid').addEventListener('click', () => setGrid(state.grid !== 'on'))
    $('#btn-drawer').addEventListener('click', () => setDrawer(state.drawer !== 'open'))
    $('#btn-undo').addEventListener('click', undo)
    $('#btn-redo').addEventListener('click', redo)
    $('#btn-preset').addEventListener('click', (event) => {
      event.stopPropagation()
      if (!presetMenu.hidden) {
        closeMenus()
        return
      }
      buildPresetMenu()
      openFloatingMenu(presetMenu, $('#btn-preset'))
    })
    $('#btn-more').addEventListener('click', (event) => {
      event.stopPropagation()
      if (!moreMenu.hidden) {
        closeMenus()
        return
      }
      buildMoreMenu()
      openFloatingMenu(moreMenu, $('#btn-more'))
    })

    presetMenu.addEventListener('click', (event) => {
      const button = event.target.closest('[data-preset]')
      if (!button) return
      closeMenus()
      applyPreset(button.dataset.preset)
    })

    moreMenu.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]')
      if (!button) return
      closeMenus()
      switch (button.dataset.action) {
        case 'export':
          exportLayout()
          break
        case 'copy':
          copyLayout()
          break
        case 'reset':
          applyPreset('classic')
          break
        case 'clear':
          applyPreset('blank')
          break
        default:
          break
      }
    })
  }

  function wireDrawer() {
    $('#drawer-close').addEventListener('click', () => setDrawer(false))
    $('#drawer-tab').addEventListener('click', () => setDrawer(true))
    $('#sb-collapse').addEventListener('click', () => setSidebar(false))
    $('#empty-classic').addEventListener('click', () => applyPreset('classic'))

    $('#insp-duplicate').addEventListener('click', () => {
      if (state.selected) duplicateWidget(state.selected)
    })
    $('#insp-delete').addEventListener('click', () => {
      if (state.selected) deleteWidget(state.selected)
    })

    let widthTimer = 0
    inspWidth.addEventListener('input', () => {
      const entry = getSelected()
      if (!entry) return
      clearTimeout(widthTimer)
      widthTimer = setTimeout(() => resizeWidth(entry, Number(inspWidth.value), false), 40)
    })
    inspWidth.addEventListener('change', () => {
      const entry = getSelected()
      if (entry) resizeWidth(entry, Number(inspWidth.value), true)
    })

    paletteSearch.addEventListener('input', () => {
      state.query = paletteSearch.value
      buildPalette()
    })

    paletteTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cat]')
      if (!button) return
      state.activeCat = button.dataset.cat
      for (const tab of paletteTabs.querySelectorAll('[data-cat]')) {
        tab.classList.toggle('is-active', tab === button)
      }
      buildPalette()
    })
  }

  function wireCanvas() {
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      if (event.target.closest('.widget')) return
      deselect()
      closeMenus()
    })

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', (event) => {
      if (!openMenuEl) return
      if (openMenuEl.contains(event.target)) return
      if (event.target.closest('#btn-preset') || event.target.closest('#btn-more')) return
      closeMenus()
    })
    document.addEventListener('dsh:toast', (event) => toast(event.detail))
    window.addEventListener('resize', () => requestAnimationFrame(layoutAll))
    window.addEventListener('blur', () => {
      closeMenus()
      hideDropPreview()
      dragGhost.hidden = true
      paletteDrag = null
      document.body.classList.remove('is-dragging')
    })

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => requestAnimationFrame(layoutAll))
      observer.observe(canvasScroll)
      observer.observe(workspace)
    }
  }

  /* ── init ──────────────────────────────────────────────────────────────── */

  function readInitialState() {
    const params = new URLSearchParams(location.search)
    const capture = params.get('capture') === '1' || params.get('capture') === 'true'
    if (capture) document.documentElement.classList.add('capture')
    // URL 驱动的状态（出图 / 分享某个预设）不回写 localStorage，避免覆盖用户自己的布局
    persistEnabled = !capture && !['preset', 'theme', 'sidebar', 'drawer', 'grid'].some((key) => params.has(key))

    const saved = capture || params.has('preset') ? null : loadSaved()

    if (saved) {
      state.theme = saved.theme
      state.sidebar = saved.sidebar
      state.drawer = saved.drawer
      state.grid = saved.grid
      state.preset = saved.preset
      state.widgets = saved.widgets
      state.rows = Math.max(saved.rows || MIN_ROWS, MIN_ROWS)
    } else {
      state.theme = 'dark'
      state.sidebar = 'open'
      state.drawer = 'open'
      state.grid = 'on'
    }

    const theme = params.get('theme')
    if (theme === 'light' || theme === 'dark') state.theme = theme
    const sidebarParam = params.get('sidebar')
    if (sidebarParam === 'closed' || sidebarParam === 'open') state.sidebar = sidebarParam
    const drawerParam = params.get('drawer')
    if (drawerParam === 'closed' || drawerParam === 'open') state.drawer = drawerParam
    const gridParam = params.get('grid')
    if (gridParam === 'off' || gridParam === 'on') state.grid = gridParam

    const presetParam = params.get('preset')
    if (presetParam && PRESETS[presetParam]) {
      const built = buildPreset(presetParam)
      if (built) {
        state.widgets = built.widgets
        state.rows = built.rows
        state.preset = presetParam
      }
    } else if (!saved) {
      const built = buildPreset('classic')
      if (built) {
        state.widgets = built.widgets
        state.rows = built.rows
        state.preset = 'classic'
      }
    } else {
      state.rows = Math.max(state.rows, requiredRows())
    }

    return { capture }
  }

  function init() {
    const { capture } = readInitialState()

    applyInitialChrome()
    buildPalette()
    renderWidgets()
    wireToolbar()
    wireDrawer()
    wireCanvas()

    if (capture) {
      deselect()
      closeMenus()
    }

    resetHistory()
    scheduleSave()

    requestAnimationFrame(() => {
      layoutAll()
      requestAnimationFrame(layoutAll)
    })
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => layoutAll()).catch(() => {})
    }

    // debugging / QA hook
    window.__DSH_PROTOTYPE__ = {
      version: '1.0.0',
      getState: () => deepCopy({ ...state, cell, rowH, stepX, stepY }),
      getCatalog: () => CATALOG.map(({ id, name, category, desc, w, h, minW, minH, maxW, maxH }) => ({ id, name, category, desc, w, h, minW, minH, maxW, maxH })),
      addWidget: (id, x, y) => {
        const def = BY_ID.get(id)
        return def ? addWidget(def, x, y) : null
      },
      applyPreset,
      setTheme,
      setSidebar,
      setDrawer,
      setGrid,
      undo,
      redo,
      select,
      deselect,
      layout: layoutAll,
      exportJSON: () => JSON.stringify(layoutPayload(), null, 2),
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
