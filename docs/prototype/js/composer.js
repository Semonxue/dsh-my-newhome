/* ────────────────────────────────────────────────────────────────────────────
   composer widget — demo of DSH's home composer
   工作区选择 + 模式选择在同一行；宽度随网格/右侧选中面板调整。
   ──────────────────────────────────────────────────────────────────────────── */

window.DSH_COMPOSER_WIDGET = {
  id: 'composer',
  name: '输入框',
  category: 'base',
  desc: '工作区 / 模式 / 发送',
  w: 16,
  h: 3,
  minW: 10,
  minH: 3,
  maxW: 22,
  maxH: 8,

  render(ctx) {
    const workspaces = [
      { id: 'acme-web', name: 'acme-web', meta: '当前工作区' },
      { id: 'data-lab', name: 'data-lab', meta: '14 个会话' },
      { id: 'notes-app', name: 'notes-app', meta: '29 个会话' },
      { id: 'video-pipeline', name: 'video-pipeline', meta: '78 个会话' },
      { id: 'content-ops', name: 'content-ops', meta: '46 个会话' },
    ]
    const modes = [
      { id: 'v4', name: 'DeepSeek V4', desc: '默认 · 均衡' },
      { id: 'v4-pro', name: 'DeepSeek V4 Pro', desc: '更强推理' },
      { id: 'reasoner', name: 'DeepSeek Reasoner', desc: '深度思考' },
    ]
    const wsOptions = workspaces
      .map(
        (ws, i) => `
        <button type="button" class="cmp-opt${i === 0 ? ' is-selected' : ''}" data-nodrag data-opt-type="workspace" data-opt-value="${ws.id}" data-opt-label="${ws.name}">
          <svg class="icon"><use href="#i-folder"/></svg>
          <span class="cmp-opt-main"><span class="cmp-opt-name">${ws.name}</span><span class="cmp-opt-desc">${ws.meta}</span></span>
          <svg class="icon cmp-opt-check"><use href="#i-check"/></svg>
        </button>`
      )
      .join('')
    const modeOptions = modes
      .map(
        (mode, i) => `
        <button type="button" class="cmp-opt${i === 0 ? ' is-selected' : ''}" data-nodrag data-opt-type="mode" data-opt-value="${mode.id}" data-opt-label="${mode.name}">
          <svg class="icon"><use href="#i-spark"/></svg>
          <span class="cmp-opt-main"><span class="cmp-opt-name">${mode.name}</span><span class="cmp-opt-desc">${mode.desc}</span></span>
          <svg class="icon cmp-opt-check"><use href="#i-check"/></svg>
        </button>`
      )
      .join('')

    return `
      <div class="w w-composer">
        <div class="cmp-card">
          <textarea class="cmp-input" rows="1" placeholder="给 DeepSeek 发消息…" spellcheck="false" data-nodrag></textarea>
          <div class="cmp-bar">
            <div class="cmp-selects">
              <button type="button" class="cmp-chip" data-nodrag data-menu="workspace" aria-expanded="false" title="选择工作区">
                <svg class="icon"><use href="#i-folder"/></svg>
                <span class="cmp-label" data-workspace-label>acme-web</span>
                <svg class="icon cmp-chev"><use href="#i-chevron"/></svg>
              </button>
              <button type="button" class="cmp-chip" data-nodrag data-menu="mode" aria-expanded="false" title="选择模式">
                <span class="cmp-spark">✦</span>
                <span class="cmp-label" data-mode-label>DeepSeek V4</span>
                <svg class="icon cmp-chev"><use href="#i-chevron"/></svg>
              </button>
            </div>
            <div class="cmp-actions">
              <button type="button" class="cmp-attach" data-nodrag title="添加附件"><svg class="icon"><use href="#i-paperclip"/></svg></button>
              <button type="button" class="cmp-send" data-nodrag title="发送（Enter）"><svg class="icon"><use href="#i-arrow-up"/></svg></button>
            </div>
          </div>

          <div class="cmp-menu" data-menu-panel="workspace" hidden>
            <div class="cmp-menu-label">工作区</div>
            ${wsOptions}
            <div class="cmp-menu-sep"></div>
            <button type="button" class="cmp-opt" data-nodrag data-action="new-workspace">
              <svg class="icon"><use href="#i-plus"/></svg>
              <span class="cmp-opt-main"><span class="cmp-opt-name">新建工作区…</span></span>
            </button>
          </div>

          <div class="cmp-menu" data-menu-panel="mode" hidden>
            <div class="cmp-menu-label">模式</div>
            ${modeOptions}
          </div>
        </div>
      </div>`
  },

  mount(root) {
    const input = root.querySelector('.cmp-input')
    const send = root.querySelector('.cmp-send')
    const triggers = [...root.querySelectorAll('[data-menu]')]
    const panels = [...root.querySelectorAll('[data-menu-panel]')]

    const closeMenus = () => {
      for (const panel of panels) panel.hidden = true
      for (const trigger of triggers) trigger.setAttribute('aria-expanded', 'false')
    }
    const openMenu = (name) => {
      for (const panel of panels) panel.hidden = panel.getAttribute('data-menu-panel') !== name
      for (const trigger of triggers) {
        trigger.setAttribute('aria-expanded', String(trigger.getAttribute('data-menu') === name))
      }
    }

    const toast = (message) => {
      root.dispatchEvent(new CustomEvent('dsh:toast', { bubbles: true, detail: message }))
    }

    const submit = () => {
      if (!input.value.trim()) {
        input.focus()
        toast('先写点什么，再发送')
        return
      }
      input.value = ''
      toast('原型演示：消息已发送')
    }

    const onClick = (event) => {
      const trigger = event.target.closest('[data-menu]')
      if (trigger) {
        event.preventDefault()
        const name = trigger.getAttribute('data-menu')
        const isOpen = trigger.getAttribute('aria-expanded') === 'true'
        if (isOpen) closeMenus()
        else openMenu(name)
        return
      }

      const option = event.target.closest('[data-opt-type]')
      if (option) {
        event.preventDefault()
        const type = option.getAttribute('data-opt-type')
        const label = option.getAttribute('data-opt-label') || ''
        if (type === 'workspace') {
          const target = root.querySelector('[data-workspace-label]')
          if (target) target.textContent = label
        } else if (type === 'mode') {
          const target = root.querySelector('[data-mode-label]')
          if (target) target.textContent = label
        }
        for (const sibling of root.querySelectorAll(`[data-opt-type="${type}"]`)) {
          sibling.classList.toggle('is-selected', sibling === option)
        }
        closeMenus()
        return
      }

      if (event.target.closest('[data-action="new-workspace"]')) {
        closeMenus()
        toast('原型演示：新建工作区')
        return
      }
      if (event.target.closest('.cmp-send')) {
        submit()
        return
      }
      if (event.target.closest('.cmp-attach')) {
        toast('原型演示：添加附件')
        return
      }
      if (!event.target.closest('.cmp-menu')) closeMenus()
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMenus()
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        if (event.target === input) {
          event.preventDefault()
          submit()
        }
      }
    }

    const onDocPointerDown = (event) => {
      if (!root.contains(event.target)) closeMenus()
    }

    root.addEventListener('click', onClick)
    root.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onDocPointerDown)
    send.setAttribute('aria-label', '发送')

    return () => {
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onDocPointerDown)
    }
  },
}
