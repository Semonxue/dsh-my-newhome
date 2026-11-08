/*!
 * DSH 沙箱组件 PoC · 宿主加载器
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 把「组件源码文本」拼成 srcdoc（bootstrap + 组件源码），用
 *      <iframe sandbox="allow-scripts" referrerpolicy="no-referrer"> 加载。
 *      不 eval、不在宿主执行组件代码。
 *   2. 实现 postMessage 桥：ready / init / request / response / event /
 *      notify / open / destroy，校验 event.source === iframe.contentWindow。
 *   3. 首次遇到某权限时弹「允许 / 拒绝」确认条（localStorage 记住选择）。
 *   4. 安全探针面板：展示每个 iframe 的 sandbox / CSP / 授权 / 拒绝次数，
 *      以及 evil-demo 回传的逐项越权结果（宿主 DOM 里可 dump-dom 取证）。
 *
 * 协议、边界、实测结果见 README.md。
 */

(function () {
  'use strict';

  /* ── 常量 ─────────────────────────────────────────────────────────────── */

  var BOOTSTRAP = document.getElementById('iframe-bootstrap').textContent;
  var WIDGET_CSS = document.getElementById('widget-css').textContent;

  var CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
    "img-src data: blob:; connect-src 'none'; font-src data:; form-action 'none'; " +
    "base-uri 'none'";

  var IFRAME_CSS = [
    'html,body{margin:0;padding:0;height:100%;background:transparent;overflow:hidden;}',
    'body{font-family:var(--font);color:var(--tx-1);-webkit-font-smoothing:antialiased;}',
    '#dsh-root{width:100%;height:100%;container-type:size;}',
    '*{box-sizing:border-box;}'
  ].join('\n');

  var PERM_STORE_KEY = 'dsh-sandbox-demo-perms-v1';
  var THEME_STORE_KEY = 'dsh-sandbox-demo-theme-v1';

  /* 权限 / 资源表：组件 manifest.permissions 里声明的字符串就是 key。
     宿主返回的都是「已脱敏」的模拟数据 —— 没有 key、没有账号、没有本地路径。 */
  var RESOURCES = {
    'usage.read': {
      label: '用量与配额',
      desc: '只返回额度百分比 / 余额数字与重置时间，不含 API Key、账号或模型参数'
    },
    'workspaces.read': {
      label: '最近工作区',
      desc: '只返回工作区名、会话数与最后使用时间，不含本地路径'
    },
    'links.read': {
      label: '常用站点',
      desc: '只返回站点标题与域名'
    },
    'time.now': {
      label: '系统时间',
      desc: '返回 ISO 时间戳。零权限的时钟组件其实不需要它，仅作权限枚举示例'
    }
  };

  var LIBRARY = [
    {
      file: 'widgets/clock-lite.js',
      label: '时钟 · 轻量',
      mark: 'C',
      grad: 'linear-gradient(135deg,var(--brand),var(--cyan))',
      size: { w: 300, h: 192 },
      hint: 'permissions: []',
      source: null,
      error: null
    },
    {
      file: 'widgets/usage-lite.js',
      label: '用量 · 轻量',
      mark: 'U',
      grad: 'linear-gradient(135deg,var(--brand),var(--violet))',
      size: { w: 300, h: 192 },
      hint: "permissions: ['usage.read']",
      source: null,
      error: null
    },
    {
      file: 'widgets/evil-demo.js',
      label: '深渊组件 · 安全探针',
      mark: '!',
      grad: 'linear-gradient(135deg,var(--red),var(--amber))',
      size: { w: 660, h: 192 },
      hint: 'permissions: [] · 全部越权应失败',
      source: null,
      error: null
    }
  ];

  /* ── 状态 ─────────────────────────────────────────────────────────────── */

  var state = {
    theme: 'dark',
    auto: null,            /* URL ?auto=allow|deny 用于无头截图，不写入 localStorage */
    instances: [],
    instanceSeq: 0,
    msgSeq: 0,
    hostsErrors: [],
    promptChain: Promise.resolve(),
    ready: false
  };

  var params = new URLSearchParams(location.search);
  if (params.get('theme') === 'light' || params.get('theme') === 'dark') {
    state.theme = params.get('theme');
  } else {
    try {
      var savedTheme = localStorage.getItem(THEME_STORE_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
    } catch (err) { /* 忽略 */ }
  }
  if (params.get('auto') === 'allow' || params.get('auto') === 'deny') {
    state.auto = params.get('auto');
  }

  /* ── 小工具 ───────────────────────────────────────────────────────────── */

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function isoInMinutes(minutes) {
    return new Date(Date.now() + minutes * 60000).toISOString();
  }

  function baseName(file) {
    return String(file).split('/').pop();
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(PERM_STORE_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (err) {
      return {};
    }
  }

  function writeStore(obj) {
    try { localStorage.setItem(PERM_STORE_KEY, JSON.stringify(obj)); }
    catch (err) { /* file:// 下可能不可用，静默降级 */ }
  }

  /* ── 脱敏模拟数据（宿主唯一的数据来源） ─────────────────────────────────── */

  function mockData(resource) {
    if (resource === 'usage.read') {
      return [
        { provider: 'DeepSeek', kind: 'balance', amount: 12.34, currency: 'CNY', tone: 'ok' },
        {
          provider: 'MiniMax', kind: 'quota',
          percent5h: 23, percentWeek: 9, percentMonth: 41,
          resetAt: isoInMinutes(134), tone: 'ok'
        },
        {
          provider: 'Cline Pass', kind: 'quota',
          percent5h: 35, percentWeek: 12, percentMonth: 35,
          resetAt: isoInMinutes(322), tone: 'ok'
        },
        {
          provider: 'OpenCode Go', kind: 'quota',
          percent5h: 62, percentWeek: 41, percentMonth: 62,
          resetAt: isoInMinutes(58), tone: 'warn'
        }
      ];
    }
    if (resource === 'workspaces.read') {
      return [
        { name: 'acme-web', sessions: 2, lastUsedAt: isoInMinutes(-120) },
        { name: 'data-lab', sessions: 14, lastUsedAt: isoInMinutes(-240) },
        { name: 'notes-app', sessions: 29, lastUsedAt: isoInMinutes(-1440) },
        { name: 'video-pipeline', sessions: 78, lastUsedAt: isoInMinutes(-4320) }
      ];
    }
    if (resource === 'links.read') {
      return [
        { title: 'GitHub', domain: 'github.com' },
        { title: 'MDN', domain: 'developer.mozilla.org' },
        { title: 'Figma', domain: 'figma.com' }
      ];
    }
    if (resource === 'time.now') {
      return { iso: new Date().toISOString() };
    }
    return null;
  }

  /* ── srcdoc 构造（字符串拼接，不 eval） ─────────────────────────────────── */

  function escapeScriptText(src) {
    /* 1) 组件源码里的 "</script" 会提前结束宿主拼出来的 <script>；
          替换成 "<\/script" 在 JS 字符串 / 正则里语义相同，但 HTML 解析器不再识别。
       2) "<!--" 会让 HTML 解析器进入 script-data-escaped 状态，同样做无害转义。
       注意：${ 和反引号不需要处理 —— 这里是把源码当「值」拼接，不会再被模板解析。 */
    return String(src)
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<\\!--');
  }

  function buildSrcdoc(inst) {
    return '<!doctype html><html lang="zh-CN" data-theme="' + state.theme + '"><head>' +
      '<meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
      '<style>' + IFRAME_CSS + '</style>' +
      '<style>' + WIDGET_CSS + '</style>' +
      '</head><body>' +
      '<div id="dsh-root"></div>' +
      '<script>' + BOOTSTRAP + '</script>' +
      '<script>' + escapeScriptText(inst.source) + '</script>' +
      '</body></html>';
  }

  function sizeContext(size) {
    return {
      w: size.w,
      h: size.h,
      cols: Math.max(1, Math.round(size.w / 48)),
      rows: Math.max(1, Math.round(size.h / 30))
    };
  }

  /* ── 实例生命周期 ──────────────────────────────────────────────────────── */

  function findInstanceBySource(src) {
    for (var i = 0; i < state.instances.length; i++) {
      var inst = state.instances[i];
      if (inst.frame && inst.frame.contentWindow === src) return inst;
    }
    return null;
  }

  function createInstance(opts) {
    var inst = {
      id: 'inst-' + (++state.instanceSeq),
      label: opts.label || baseName(opts.file || 'widget'),
      file: opts.file || '(内联源码)',
      source: opts.source,
      size: opts.size || { w: 320, h: 220 },
      autoSize: !!opts.autoSize,
      theme: state.theme,
      manifest: null,
      declared: [],
      granted: [],
      denied: 0,
      requests: 0,
      notifies: [],
      probes: null,
      diag: null,
      errors: [],
      ready: false,
      destroyed: false,
      slot: null,
      frame: null,
      frameWrap: null,
      resizeObserver: null
    };
    inst.srcdoc = buildSrcdoc(inst);
    mountInstance(inst);
    state.instances.push(inst);
    return inst;
  }

  function mountInstance(inst) {
    var slot = h('div', 'slot');
    slot.dataset.instance = inst.id;
    slot.style.width = inst.size.w + 'px';

    var chrome = h('div', 'slot-chrome');
    var nameEl = h('span', 'slot-name', inst.label);
    var dimsEl = h('span', 'slot-dims', inst.size.w + '×' + inst.size.h);
    var spacer = h('span', 'slot-spacer');
    var close = h('button', 'slot-close', '×');
    close.type = 'button';
    close.title = '卸载实例（触发 destroy → cleanup）';
    close.addEventListener('click', function () { destroyInstance(inst); });
    chrome.appendChild(nameEl);
    chrome.appendChild(dimsEl);
    chrome.appendChild(spacer);
    chrome.appendChild(close);

    var wrap = h('div', 'slot-frame');
    wrap.style.width = inst.size.w + 'px';
    wrap.style.height = inst.size.h + 'px';

    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', inst.label + ' · 沙箱实例');
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.srcdoc = inst.srcdoc;
    wrap.appendChild(frame);

    slot.appendChild(chrome);
    slot.appendChild(wrap);
    document.getElementById('canvas-grid').appendChild(slot);

    inst.slot = slot;
    inst.frame = frame;
    inst.frameWrap = wrap;

    /* 尺寸变化 → resize 事件（组件的 ctx.size 与 on('resize') 用它） */
    if (typeof ResizeObserver === 'function') {
      inst.resizeObserver = new ResizeObserver(function () {
        var w = Math.round(wrap.clientWidth);
        var ht = Math.round(wrap.clientHeight);
        if (!w || !ht) return;
        if (w === inst.size.w && ht === inst.size.h) return;
        inst.size = { w: w, h: ht };
        inst.slot.style.width = w + 'px';
        dimsEl.textContent = w + '×' + ht;
        postTo(inst, { t: 'event', event: 'resize', payload: { size: sizeContext(inst.size) } });
      });
      inst.resizeObserver.observe(wrap);
    }
  }

  function resizeInstance(inst, w, ht) {
    inst.size = { w: w, h: ht };
    inst.slot.style.width = w + 'px';
    inst.frameWrap.style.width = w + 'px';
    inst.frameWrap.style.height = ht + 'px';
    inst.slot.querySelector('.slot-dims').textContent = w + '×' + ht;
  }

  function destroyInstance(inst) {
    if (inst.destroyed) return;
    inst.destroyed = true;
    postTo(inst, { t: 'destroy' });
    if (inst.resizeObserver) inst.resizeObserver.disconnect();
    /* 给 destroy 消息一个微任务窗口去跑 cleanup，然后摘掉 iframe */
    setTimeout(function () {
      if (inst.slot && inst.slot.parentNode) inst.slot.parentNode.removeChild(inst.slot);
      inst.frame = null;
    }, 0);
    state.instances = state.instances.filter(function (x) { return x !== inst; });
    updateAll();
  }

  function postTo(inst, msg) {
    if (!inst.frame || !inst.frame.contentWindow) return;
    try {
      inst.frame.contentWindow.postMessage(msg, '*');
    } catch (err) {
      inst.errors.push('宿主 postMessage 失败：' + (err && err.message));
    }
  }

  function respond(inst, id, payload) {
    var msg = { t: 'response', id: id, ok: !!payload.ok };
    if (payload.ok) msg.data = payload.data;
    else msg.error = payload.error || { code: 'E_UNKNOWN', message: '未知错误' };
    postTo(inst, msg);
  }

  function sendInit(inst) {
    var data = {};
    inst.granted.forEach(function (resource) { data[resource] = mockData(resource); });
    postTo(inst, {
      t: 'init',
      seq: ++state.msgSeq,
      ctx: {
        theme: state.theme,
        size: sizeContext(inst.size),
        locale: 'zh-CN',
        instanceId: inst.id,
        now: new Date().toISOString(),
        data: data
      }
    });
  }

  /* ── 权限授权 ─────────────────────────────────────────────────────────── */

  function authorize(inst, permission) {
    if (!RESOURCES[permission]) {
      return Promise.resolve({ ok: false, code: 'E_UNKNOWN_RESOURCE' });
    }
    if (inst.declared.indexOf(permission) < 0) {
      return Promise.resolve({ ok: false, code: 'E_PERM_NOT_DECLARED' });
    }
    var store = readStore();
    if (store[permission] === 'allow') return Promise.resolve({ ok: true, source: 'stored' });
    if (store[permission] === 'deny') return Promise.resolve({ ok: false, code: 'E_PERM_DENIED' });
    if (state.auto === 'allow') return Promise.resolve({ ok: true, source: 'auto' });
    if (state.auto === 'deny') return Promise.resolve({ ok: false, code: 'E_PERM_DENIED' });
    return enqueuePrompt(inst, permission);
  }

  function denialMessage(code, permission) {
    if (code === 'E_PERM_NOT_DECLARED') {
      return '组件没有在 permissions 里声明 ' + permission + '，宿主直接拒绝';
    }
    if (code === 'E_PERM_DENIED') return '用户拒绝了 ' + permission;
    if (code === 'E_UNKNOWN_RESOURCE') return '未知资源：' + permission;
    return code;
  }

  function showPrompt(options) {
    /* options: { title, sub, allowText, denyText, permission?, inst? } */
    return new Promise(function (resolve) {
      var host = document.getElementById('prompt-host');
      var box = h('div', 'prompt');

      var mark = h('span', 'prompt-mark', '⛨');
      var body = h('div', 'prompt-body');
      var title = h('div', 'prompt-title');
      title.textContent = options.title;
      var sub = h('div', 'prompt-sub');
      sub.textContent = options.sub;
      body.appendChild(title);
      body.appendChild(sub);

      var actions = h('div', 'prompt-actions');
      var deny = h('button', 'btn', options.denyText || '拒绝');
      deny.type = 'button';
      var allow = h('button', 'btn btn-primary', options.allowText || '允许');
      allow.type = 'button';
      actions.appendChild(deny);
      actions.appendChild(allow);

      box.appendChild(mark);
      box.appendChild(body);
      box.appendChild(actions);
      host.appendChild(box);

      function finish(decision) {
        if (box.parentNode) box.parentNode.removeChild(box);
        resolve(decision);
      }
      deny.addEventListener('click', function () { finish('deny'); });
      allow.addEventListener('click', function () { finish('allow'); });
    });
  }

  function enqueuePrompt(inst, permission) {
    var meta = RESOURCES[permission];
    var task = state.promptChain.then(function () {
      return showPrompt({
        title: '「' + inst.label + '」请求 ' + permission,
        sub: meta.label + ' · ' + meta.desc + '（选择会记住，可用「重置授权记忆」清除）',
        allowText: '允许',
        denyText: '拒绝'
      }).then(function (decision) {
        if (decision !== 'allow' && decision !== 'deny') {
          return { ok: false, code: 'E_PERM_DENIED' };
        }
        var store = readStore();
        store[permission] = decision;
        writeStore(store);
        return decision === 'allow'
          ? { ok: true, source: 'user' }
          : { ok: false, code: 'E_PERM_DENIED' };
      });
    });
    state.promptChain = task.then(function () { }, function () { });
    return task;
  }

  /* ── 桥：iframe → 宿主 ─────────────────────────────────────────────────── */

  window.addEventListener('message', function (ev) {
    if (!ev.data || typeof ev.data !== 'object' || typeof ev.data.t !== 'string') return;
    var inst = findInstanceBySource(ev.source);   /* ← 只认这个 iframe 的 contentWindow */
    if (!inst) return;
    var msg = ev.data;

    if (msg.t === 'ready') return onReady(inst, msg);
    if (msg.t === 'request') return onRequest(inst, msg);
    if (msg.t === 'notify') return onNotify(inst, msg);
    if (msg.t === 'open') return onOpen(inst, msg);
    if (msg.t === 'probe') return onProbe(inst, msg);
    if (msg.t === 'diag') return onDiag(inst, msg);
    if (msg.t === 'error') return onWidgetError(inst, msg);
    if (msg.t === 'destroyed') return;
  });

  function onReady(inst, msg) {
    if (msg.error || !msg.widget) {
      var errMsg = (msg.error && msg.error.message) || '组件未调用 DSH_WIDGET.define(...)';
      inst.errors.push(errMsg);
      inst.ready = false;
      updateAll();
      return;
    }
    inst.manifest = msg.widget;
    inst.declared = (msg.widget.permissions || []).slice();
    inst.label = msg.widget.id || inst.label;
    inst.slot.querySelector('.slot-name').textContent = inst.label;
    inst.ready = true;

    /* 导入的组件按 manifest.grid 建议尺寸（库里的示例用固定演示尺寸） */
    if (inst.autoSize && inst.manifest.grid) {
      var w = clamp((inst.manifest.grid.w || 5) * 56, 280, 480);
      var ht = clamp((inst.manifest.grid.h || 3) * 54, 198, 320);
      resizeInstance(inst, w, ht);
    }

    /* 先 init（ctx.data 为空）让组件立刻渲染「等待授权」状态，
       再逐个走授权；授权成功后用 data 事件把脱敏数据推给组件。
       这样首屏不会白着等确认条，协议顺序也仍是 ready → init。 */
    sendInit(inst);
    updateAll();

    var chain = Promise.resolve();
    inst.declared.forEach(function (permission) {
      chain = chain.then(function () {
        return authorize(inst, permission).then(function (res) {
          if (res.ok) {
            if (inst.granted.indexOf(permission) < 0) inst.granted.push(permission);
            postTo(inst, {
              t: 'event',
              event: 'data',
              payload: { resource: permission, data: mockData(permission) }
            });
          } else {
            inst.denied++;
          }
          updateAll();
        });
      });
    });
  }

  function onRequest(inst, msg) {
    inst.requests++;
    var resource = String(msg.resource || '');
    if (!RESOURCES[resource]) {
      inst.denied++;
      respond(inst, msg.id, {
        ok: false,
        error: { code: 'E_UNKNOWN_RESOURCE', message: '未知资源：' + resource }
      });
      updateAll();
      return;
    }
    authorize(inst, resource).then(function (res) {
      if (!res.ok) {
        inst.denied++;
        respond(inst, msg.id, {
          ok: false,
          error: { code: res.code, message: denialMessage(res.code, resource) }
        });
        updateAll();
        return;
      }
      if (inst.granted.indexOf(resource) < 0) inst.granted.push(resource);
      var payload = mockData(resource);
      respond(inst, msg.id, { ok: true, data: payload });
      postTo(inst, {
        t: 'event',
        event: 'data',
        payload: { resource: resource, data: payload }
      });
      updateAll();
    });
  }

  function onNotify(inst, msg) {
    var entry = {
      level: String(msg.level || 'info'),
      text: String(msg.text == null ? '' : msg.text)
    };
    inst.notifies.push(entry);
    if (inst.notifies.length > 6) inst.notifies.shift();
    updateAll();
  }

  function onOpen(inst, msg) {
    var url = String(msg.url || '');
    var safe = /^https?:\/\//i.test(url) ? url : null;
    if (!safe) {
      inst.notifies.push({ level: 'warn', text: '只能打开 http(s) 链接' });
      updateAll();
      return;
    }
    showPrompt({
      title: '「' + inst.label + '」请求打开外部链接',
      sub: safe + ' —— 宿主二次确认后才 window.open',
      allowText: '打开',
      denyText: '取消'
    }).then(function (decision) {
      if (decision !== 'allow') return;
      try { window.open(safe, '_blank', 'noopener'); } catch (err) { /* 弹窗被拦 */ }
    });
  }

  function onProbe(inst, msg) {
    inst.probes = (msg.items || []).map(function (item) {
      return {
        name: String(item.name || '?'),
        ok: !!item.ok,
        detail: String(item.detail || '')
      };
    });
    updateAll();
  }

  function onDiag(inst, msg) {
    inst.diag = msg.info || null;
    updateAll();
  }

  function onWidgetError(inst, msg) {
    inst.errors.push(String(msg.message || '未知错误'));
    if (state.hostsErrors.length < 20) state.hostsErrors.push(inst.id + '：' + msg.message);
    updateAll();
  }

  /* ── 组件库 / 导入 / 主题 ─────────────────────────────────────────────── */

  function loadLibraryItem(item) {
    return fetch(item.file, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      item.source = text;
      item.error = null;
    }).catch(function (err) {
      item.source = null;
      item.error = err && err.message ? err.message : String(err);
    });
  }

  function renderLibrary() {
    var box = document.getElementById('library');
    box.innerHTML = '';
    LIBRARY.forEach(function (item) {
      var row = h('div', 'lib-item');
      var mark = h('span', 'lib-mark', item.mark);
      mark.style.background = item.grad;
      var main = h('span', 'lib-main');
      var name = h('span', 'lib-name', item.label);
      var meta = h('span', 'lib-meta');
      meta.textContent = item.error
        ? '加载失败：' + item.error
        : (item.source ? baseName(item.file) + ' · ' + item.hint : '加载中…');
      main.appendChild(name);
      main.appendChild(meta);
      var add = h('button', 'lib-add', '添加');
      add.type = 'button';
      add.disabled = !item.source;
      add.addEventListener('click', function () {
        if (!item.source) return;
        addInstance({
          file: item.file,
          label: item.label,
          source: item.source,
          size: { w: item.size.w, h: item.size.h }
        });
      });
      row.appendChild(mark);
      row.appendChild(main);
      row.appendChild(add);
      box.appendChild(row);
    });
  }

  function addInstance(opts) {
    var inst = createInstance(opts);
    updateAll();
    return inst;
  }

  function importSource(source, label) {
    if (typeof source !== 'string' || !source.trim()) {
      setImportNote('导入失败：组件源码为空', true);
      return;
    }
    addInstance({
      file: label,
      label: label,
      source: source,
      size: { w: 340, h: 220 },
      autoSize: true
    });
    setImportNote('已导入「' + label + '」：源码只进了 iframe，宿主没有执行它。', false);
  }

  function setImportNote(text, isError) {
    var note = document.getElementById('import-note');
    note.textContent = text;
    note.dataset.tone = isError ? 'err' : '';
  }

  function applyTheme(theme, persist) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    document.querySelectorAll('#theme-seg [data-theme-value]').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-theme-value') === state.theme);
    });
    state.instances.forEach(function (inst) {
      inst.theme = state.theme;
      postTo(inst, { t: 'event', event: 'theme', payload: { theme: state.theme } });
    });
    if (persist) {
      try { localStorage.setItem(THEME_STORE_KEY, state.theme); } catch (err) { /* 忽略 */ }
    }
  }

  /* ── 渲染：安全探针面板 / 状态栏 ──────────────────────────────────────── */

  function probeStats() {
    var items = [];
    state.instances.forEach(function (inst) {
      if (inst.probes) items = items.concat(inst.probes);
    });
    var blocked = items.filter(function (item) { return !item.ok; }).length;
    var granted = [];
    state.instances.forEach(function (inst) {
      inst.granted.forEach(function (permission) {
        if (granted.indexOf(permission) < 0) granted.push(permission);
      });
    });
    var denied = state.instances.reduce(function (sum, inst) { return sum + inst.denied; }, 0);
    return { total: items.length, blocked: blocked, failed: items.length - blocked, granted: granted, denied: denied };
  }

  function kvRow(k, v, tone) {
    var row = h('div', 'kv');
    row.appendChild(h('span', 'k', k));
    var val = h('span', 'v' + (tone ? ' ' + tone : ''), v);
    val.title = String(v);
    row.appendChild(val);
    return row;
  }

  function instanceProbeColumn(inst) {
    var col = h('div', 'probe-col');
    col.dataset.instance = inst.id;

    var titleRow = h('div', 'probe-title');
    var dot = h('span', 'dot');
    if (!inst.ready) dot.className = 'dot wait';
    else if (inst.errors.length) dot.className = 'dot err';
    titleRow.appendChild(dot);
    titleRow.appendChild(h('span', 'name', inst.manifest ? inst.manifest.id : inst.label));
    titleRow.appendChild(h('span', 'iid', inst.id));
    col.appendChild(titleRow);

    col.appendChild(kvRow('sandbox', 'allow-scripts', 'good'));
    col.appendChild(kvRow('origin', 'null（opaque，非宿主源）', 'good'));
    col.appendChild(kvRow('CSP', CSP, 'dim'));
    col.appendChild(kvRow('声明权限', inst.declared.length ? inst.declared.join(', ') : '—'));
    col.appendChild(kvRow('已授权', inst.granted.length ? inst.granted.join(', ') : '—',
      inst.granted.length ? 'good' : 'dim'));
    col.appendChild(kvRow('请求 / 拒绝', inst.requests + ' / ' + inst.denied,
      inst.denied > 0 ? 'bad' : 'dim'));
    if (!inst.probes) {
      col.appendChild(kvRow('srcdoc', 'CSP meta + bootstrap + 组件源码（无 eval）', 'dim'));
    }

    if (inst.diag && !inst.probes) {
      col.appendChild(kvRow('渲染', inst.diag.htmlLen + ' B · ' +
        inst.diag.firstW + '×' + inst.diag.firstH + ' · theme=' + inst.diag.theme, 'dim'));
    }

    if (inst.notifies.length) {
      var last = inst.notifies[inst.notifies.length - 1];
      col.appendChild(kvRow('最近消息', last.level + ' · ' + last.text, 'dim'));
    } else if (!inst.probes) {
      col.appendChild(kvRow('最近消息', '—', 'dim'));
    }

    if (inst.probes) {
      var table = h('table', 'ptable');
      var thead = h('thead');
      var trh = h('tr');
      ['探针', '结果', '错误类型 / 说明'].forEach(function (label) {
        trh.appendChild(h('th', null, label));
      });
      thead.appendChild(trh);
      table.appendChild(thead);
      var tbody = h('tbody');
      inst.probes.forEach(function (item) {
        var tr = h('tr');
        tr.dataset.probe = item.name;
        tr.appendChild(h('td', 'probe-name', item.name));
        var resCell = h('td', item.ok ? 'res-bad' : 'res-ok', item.ok ? '成功' : '被拦截');
        tr.appendChild(resCell);
        var detail = h('td', null, item.detail);
        detail.title = item.detail;
        tr.appendChild(detail);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      col.appendChild(table);
    }

    if (inst.errors.length) {
      var errRow = kvRow('错误', inst.errors[inst.errors.length - 1], 'bad');
      col.appendChild(errRow);
    }

    return col;
  }

  function updateAll() {
    var grid = document.getElementById('probe-grid');
    grid.innerHTML = '';
    if (!state.instances.length) {
      var empty = h('div', 'probe-col');
      empty.appendChild(h('div', 'probe-title'));
      empty.appendChild(kvRow('状态', '等待组件实例', 'dim'));
      grid.appendChild(empty);
    }
    state.instances.forEach(function (inst) {
      grid.appendChild(instanceProbeColumn(inst));
    });

    var stats = probeStats();
    var summary = document.getElementById('probe-summary');
    if (stats.total === 0) {
      summary.textContent = state.instances.length
        ? '实例已启动，等待探针回传…'
        : '没有实例';
    } else {
      summary.textContent = '探针 ' + stats.blocked + '/' + stats.total + ' 被拦截' +
        ' · 已授权 ' + (stats.granted.length ? stats.granted.join(', ') : '无') +
        ' · 拒绝 ' + stats.denied + ' 次' +
        ' · 宿主侧异常 ' + state.hostsErrors.length + ' 条';
    }

    var pill = document.getElementById('status-pill');
    var text = document.getElementById('status-text');
    var errCount = state.hostsErrors.length;
    var ok = stats.total > 0 && stats.failed === 0 && errCount === 0;
    pill.dataset.state = ok ? 'ok' : (stats.failed > 0 || errCount > 0 ? 'warn' : '');
    text.textContent = state.instances.length + ' 个沙箱实例' +
      (stats.total ? ' · 探针 ' + stats.blocked + '/' + stats.total + ' 拦截' : ' · 启动中') +
      (errCount ? ' · 异常 ' + errCount : '');

    var chip = document.getElementById('canvas-chip');
    chip.textContent = state.instances.length + ' 实例 · iframe sandbox=allow-scripts';
  }

  /* ── 原生 chrome 绑定 ─────────────────────────────────────────────────── */

  function bindChrome() {
    document.querySelectorAll('#theme-seg [data-theme-value]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyTheme(btn.getAttribute('data-theme-value'), true);
      });
    });

    document.getElementById('reset-perms').addEventListener('click', function () {
      try { localStorage.removeItem(PERM_STORE_KEY); } catch (err) { /* 忽略 */ }
      state.auto = null;
      setImportNote('已清空授权记忆：下次请求会重新弹确认条（也可用 URL ?auto=allow 自动授权）。', false);
    });

    document.getElementById('file-input').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      document.getElementById('file-name').textContent = file.name;
      var reader = new FileReader();
      reader.onload = function () { importSource(String(reader.result || ''), file.name); };
      reader.onerror = function () { setImportNote('读取文件失败', true); };
      reader.readAsText(file);
      ev.target.value = '';
    });

    document.getElementById('url-btn').addEventListener('click', function () {
      var input = document.getElementById('url-input');
      var url = (input.value || '').trim();
      if (!url) { setImportNote('请先粘贴组件 URL', true); return; }
      setImportNote('正在拉取 ' + url + ' …', false);
      fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      }).then(function (text) {
        importSource(text, baseName(url) || 'url-widget.js');
      }).catch(function (err) {
        setImportNote('导入失败：' + (err && err.message) +
          '（跨域需要 CORS；file:// 下 fetch 不可用，请用「从文件导入」）', true);
      });
    });
  }

  /* ── 启动 ─────────────────────────────────────────────────────────────── */

  function addPlaceholderCard() {
    var placeholder = h('div', 'slot-placeholder');
    var p = h('div');
    p.appendChild(h('b', null, '＋ 更多组件'));
    p.appendChild(document.createTextNode('从右侧组件库点「添加」，'));
    p.appendChild(document.createElement('br'));
    p.appendChild(document.createTextNode('或用文件 / URL 导入一个 .js 组件包'));
    placeholder.appendChild(p);
    document.getElementById('canvas-grid').appendChild(placeholder);
  }

  function addBridgeCard() {
    var info = h('div', 'info-card');
    info.appendChild(h('div', 'info-title', '桥协议（白名单，v0）'));
    [
      ['iframe → 宿主', 'ready · request · notify · open · probe'],
      ['宿主 → iframe', 'init · response · event · destroy'],
      ['序号', 'request.id ↔ response.id 原样回传'],
      ['目标源', "postMessage(msg, '*')，宿主校验 event.source"],
      ['数据', '只有 manifest 声明的权限才会拿到脱敏 mock'],
      ['隔离', 'sandbox=allow-scripts + CSP，无 eval']
    ].forEach(function (pair) {
      var row = h('div', 'info-row');
      row.appendChild(h('span', 'info-k', pair[0]));
      row.appendChild(h('span', 'info-v', pair[1]));
      info.appendChild(row);
    });
    document.getElementById('canvas-grid').appendChild(info);
  }

  function init() {
    applyTheme(state.theme, false);
    bindChrome();
    renderLibrary();

    Promise.all(LIBRARY.map(loadLibraryItem)).then(function () {
      renderLibrary();
      var failed = LIBRARY.filter(function (item) { return !item.source; });
      if (failed.length) {
        setImportNote('组件包加载失败（' + failed[0].error +
          '）：请用 http:// 起服务；file:// 下请改用「从文件导入」。', true);
        addPlaceholderCard();
        addBridgeCard();
        updateAll();
        return;
      }
      /* 左侧画布布局顺序：时钟 · 用量 · 占位 / 越权探针 · 桥协议说明 */
      addInstance({
        file: LIBRARY[0].file, label: LIBRARY[0].label,
        source: LIBRARY[0].source, size: LIBRARY[0].size
      });
      addInstance({
        file: LIBRARY[1].file, label: LIBRARY[1].label,
        source: LIBRARY[1].source, size: LIBRARY[1].size
      });
      addPlaceholderCard();
      addInstance({
        file: LIBRARY[2].file, label: LIBRARY[2].label,
        source: LIBRARY[2].source, size: LIBRARY[2].size
      });
      addBridgeCard();
      state.ready = true;
      updateAll();
    });
  }

  /* 只读调试入口，方便自动化回归 / 人工在控制台核对 */
  window.__DSH_SANDBOX_POC__ = {
    getState: function () {
      return {
        theme: state.theme,
        auto: state.auto,
        instances: state.instances.map(function (inst) {
          return {
            id: inst.id,
            label: inst.label,
            declared: inst.declared.slice(),
            granted: inst.granted.slice(),
            denied: inst.denied,
            requests: inst.requests,
            ready: inst.ready,
            probes: inst.probes,
            errors: inst.errors.slice(),
            notifies: inst.notifies.slice(),
            sandbox: inst.frame ? inst.frame.getAttribute('sandbox') : null,
            srcdocHasCsp: !!(inst.frame && inst.frame.srcdoc.indexOf('Content-Security-Policy') >= 0)
          };
        }),
        probeStats: probeStats(),
        hostErrors: state.hostsErrors.slice()
      };
    }
  };

  init();
}());
