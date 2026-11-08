# 不可信第三方主页组件：沙箱与隔离的 Web 平台事实

> 证据：①本机 Chrome **156.0.8078.81**（macOS，headless+CDP）逐项实测；②DSH 桌面端 `app.asar`
> 取证（Electron **44.7.0** / Chromium **152.0.7977.130**）；③规范/MDN。跨版本差异见第 8 节。

## 0. 结论先行

1. **`<iframe sandbox="allow-scripts">`（不加 `allow-same-origin`）是当前唯一可用、且不用改宿主的
   "单文件 JS 不可信"边界**：子文档是 opaque origin（`self.origin==="null"`），读不到父文档、无任何存储、
   开不了窗口/表单/下载/全屏/指针锁，但仍能发网络请求——这正是要用 CSP 补的地方。
2. **srcdoc 继承父文档 CSP（header 与 meta 都继承，实测）**，孩子自己的 meta 只能加严不能放宽；
   父文档没有 CSP 时孩子什么也不继承 ⇒ 必须把 CSP 写进 srcdoc 自己（meta 放最前）。
3. **srcdoc 帧不受父文档 `frame-src` 约束**（`frame-src 'none'` 下 srcdoc 仍加载），`data:`/`blob:` 帧受约束。
4. **Chromium 把 opaque-origin 沙箱帧放进独立渲染进程**（实测两个沙箱 iframe 都是 CDP `type=iframe` OOPIF；
   子帧 `while(true){}` 时父页定时器照常跑且能 `iframe.remove()`）。这使"看门狗超时重建"成立；
   一旦加 `allow-same-origin` 变同源，同进程死循环直接冻结整页（实测 CDP 求值超时）。
5. **内存不能限制**，CPU 无配额；只有网络（CSP）、生命周期（心跳/超时/重建）、可见性节流可控。
6. **自导航外泄无法用 CSP 阻止**：`navigate-to` 未实现（Chrome 156 写了 header 照跳），
   沙箱允许帧自己导航到 `https://evil/?data=…`。只能靠心跳 + 数据最小化 + 事后摘除。
7. **Shadow DOM 不是安全边界**：同 realm/origin/堆，`mode:'closed'` 只是封装，原型链可绕过；
   安全边界只有"跨 origin + 跨进程"。
8. **供应链**：SRI 对动态注入的 `<script src>` 有效（错 hash 被拦，实测），但 `import()`/inline/blob 不适用；
   实用做法是宿主侧先 sha256/Ed25519 校验再注入（Chromium 152/156 均支持 WebCrypto Ed25519，实测 156 可用）。

## 1. `sandbox="allow-scripts"` 逐项能力（Chrome 156 实测，错误原文节选）

| 能力 | 结果 | 证据 |
|---|---|---|
| `parent.document` / `top.location` | ❌ SecurityError | "Blocked a frame with origin \"null\" from accessing a cross-origin frame." |
| `document.domain` 读/写 | 读 `""`；写 ❌ | "Assignment is forbidden for sandboxed iframes." |
| `localStorage`/`sessionStorage`/`caches` | ❌ SecurityError | "The document is sandboxed and lacks the 'allow-same-origin' flag." |
| `indexedDB.open` | ❌ SecurityError | "access to the Indexed Database API is denied in this context." |
| `document.cookie` 读/写 | ❌ SecurityError | 同上 "lacks the 'allow-same-origin' flag" |
| `window.open` / `target=_blank` | ❌ 返回 `null` | 无 `allow-popups` |
| 表单 `requestSubmit()` | ❌ 不发 submit 事件 | 无 `allow-forms` |
| 下载 `<a download>` | ❌（规范） | 无 `allow-downloads`；未单独实测 |
| 全屏 | `fullscreenEnabled=false`，请求 ❌ | "Disallowed by permissions policy"（无 `allow-fullscreen`） |
| `requestPointerLock()` | ❌ SecurityError | "…frame is sandboxed and the 'allow-pointer-lock' permission is not set." |
| `navigator.clipboard` | 对象存在；读权限 `denied` | headless 无焦点（"Document is not focused"），真实授予**未验证** |
| `fetch` / `XMLHttpRequest` | ✅ 可发（受 CORS 约束） | 无 CSP 时 `/ping` 正常 |
| `new Function` / `eval` | ✅ | CSP 未禁止时 |
| `postMessage` → 父页 | ✅ | `event.origin==="null"`；`event.source===iframe.contentWindow` 可校验 |
| `MessageChannel` | ✅ | 握手后传 `MessagePort`，后续消息不依赖 origin |
| 帧内自导航 `location.href=…` | ✅ 允许（外泄通道） | 服务端日志确认 `/nav-target` 命中 |
| `window.frameElement` | `null` | 无法回指宿主 |
| 父页读 `iframe.contentWindow.location` | ❌ SecurityError | 父页只能操作 `src`/`srcdoc` 与几何盒 |
| 加上 `allow-same-origin` | ⚠️ 边界失效 | 实测可读 `parent.document`、可写 `localStorage`、**同进程**（死循环冻结整页） |

来源：[MDN `<iframe>` sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)、
[HTML 规范 sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)、
[MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)。
opaque 子帧的推荐校验：`if (event.source !== iframe.contentWindow) return;`——`origin==="null"` 本身不可信。

## 2. 代码加载方式（全部实测）

| 方式 | 可行 | 坑 |
|---|---|---|
| srcdoc 内联 `<script>` | ✅ | 拼接时必须自行转义 `</script>`（首次测试即被截断）；`document.baseURI` 继承父页 URL，相对路径可解析但仍是 opaque origin 的 no-cors 请求 |
| srcdoc + `<script src="data:…">` | ✅ | 需 CSP `script-src` 放行 `data:`；classic script 无 CORS 需求 |
| srcdoc + 父页创建的 `blob:` 脚本 | ❌ | blob URL store 按 origin 隔离，opaque 子帧取不到父页 blob（同源 srcdoc 可以） |
| 子帧内自建 blob 再加载 | ✅ | 实测执行；受 `script-src blob:` 约束 |
| 独立 http 路由 `<script src>` | ✅ | classic 脚本 no-cors，能跨 opaque origin 执行；脚本内 `self.origin` 仍是 `"null"` |
| 同源 module `<script type=module>` | ❌（无 CORS 时） | "Failed to fetch dynamically imported module"（实测）；加 ACAO 后可加载 |
| inline module script | ✅ | — |
| 动态 `import('data:…')` | ✅ | 需 CSP `script-src data:`，否则被 CSP 拦（实测） |
| `import()` 相对路径 / 同源 http | ❌（无 CORS 时） | opaque origin 下所有 module 抓取按跨域处理 |

结论：**最稳的是 srcdoc 内联引导脚本 + 组件代码以字符串注入**；外部化仅在"宿主 http 路由 +
`script-src` 放行 + classic script"时可行。若 DSH 将来给页面加 CSP，srcdoc 会继承，inline 可能直接失效。

## 3. 用 CSP 掐断外泄（srcdoc 内 meta）

实测策略 `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline';
img-src 'none'; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none';
form-action 'none'; base-uri 'none'; worker-src 'none'`：fetch/XHR/`new Image()`/外部 `<script src>`/
`import('data:…')`/blob Worker **全部被拦**。

| 指令 | 作用 | 备注 |
|---|---|---|
| `default-src 'none'` | 兜底 | 必写，覆盖 `manifest-src`/`object-src` 等 |
| `connect-src 'none'` | fetch/XHR/WS/SSE/`sendBeacon`/`<a ping>` | 外泄主通道，必须 |
| `img-src`/`font-src`/`media-src` 'none' | 像素/字体/媒体侧信道 | CSS `url()` 也走 img-src |
| `form-action 'none'` | 表单提交 | 沙箱已挡，双保险 |
| `base-uri 'none'` | 禁 `<base>` 劫持相对 URL | meta 中合法 |
| `frame-src 'none'` | 孙帧网络/钓鱼 | **不拦本帧 srcdoc 自身**（见 0.3） |
| `worker-src 'none'` | 禁 Worker（含 blob） | 否则可 `importScripts` 绕过语义 |
| `navigate-to 'none'` | 拦自导航/`window.open` | **Chrome 156 未实现**（实测照跳）；Firefox 已移除（[bug 1793560](https://bugzilla.mozilla.org/show_bug.cgi?id=1793560)） |
| `frame-ancestors`/`report-uri`/`sandbox` | — | **meta 中无效**，只能 header；srcdoc 无 header，故不可用 |

srcdoc 下三条硬规则：①**CSP meta 放 `<head>` 最前**——策略从解析到该 meta 才生效，之前的 inline 照跑
（本机复现）；②父文档有 CSP 时是**交集**，孩子的 `script-src 'unsafe-inline'` 不能放宽父文档
`script-src 'self'`（实测）；③父文档 CSP 走 header 或 meta 都会被继承（均实测），但 DSH 今天页面级
CSP 为空（第 6 节），所以只有我们自己写的 meta 生效。CSP 管不到三件事：**帧内自导航**、
**纯 CPU/内存消耗**、**元数据发送**（`postMessage` 的 origin 头等，不是内容外泄）。

来源：[CSP3](https://www.w3.org/TR/CSP3/)、[MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)、
[HTML 规范 policy container 继承](https://html.spec.whatwg.org/multipage/document-sequences.html#determining-the-policy-container)。

## 4. 资源与稳定性

**定时器节流（2s 窗口，`setInterval(…,16)`，实测）**：可见帧 125 ticks / 119 rAF；`display:none` 4 ticks /
1 rAF；移出视口 3 ticks / 0~3 rAF；0×0 尺寸 125 / 240（headless 无 vsync，仅参考）。即**不可见帧定时器
压到约 1 次/秒、rAF 基本停摆**；整页后台另有 1 次/秒、隐藏 5 分钟后 1 次/分钟的密集节流
（[Chrome 88 起](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)）。推论：时钟/轮播类
组件在宿主切走或滚出视口后会"停表"——宿主须用 `IntersectionObserver` + `postMessage` 告知可见性，
或让组件用"渲染时读当前时间"的无状态写法。

**死循环 / 卡主线程（实测）**：`allow-scripts` 下子帧独立 renderer，父页定时器照常、能 `iframe.remove()`
⇒ 超时看门狗 + 重建可行；`allow-scripts allow-same-origin` 下同进程，`while(true){}` 冻结整页
（CDP 求值超时）⇒ **绝不能给 `allow-same-origin`**。注意进程隔离是 Chromium 实现细节而非 Web 标准，
Electron 关闭 site isolation 时会退化（第 8 节）。重建细节：先 `remove()` 再新建，`src='about:blank'`
不够（旧文档仍活）；被 remove 的帧进程回收时间不可控，别在同一 tick 连续重建。

**内存**：没有任何给父页的 per-iframe 配额；opaque origin 下 `navigator.storage`/`caches` 不可用（实测）。
现实做法：组件数量上限 + `maxW/maxH` + 超时/异常摘除 + 定期整页重挂。

**Worker + OffscreenCanvas 能否替代 DOM**：可做纯计算/纯画布组件（图表、粒子），做不了 HTML 卡片；
Worker 需 CSP 放行（`worker-src blob:`），Worker 内一样能 fetch（connect-src 管住）、一样能死循环
（但只烧 worker 线程，`worker.terminate()` 可杀）。要"绝不卡 UI"就得把协议降级为"纯数据 render + 宿主绘制"。

**Shadow DOM 为什么不是安全边界**：与宿主同 document、同全局对象、同 origin；`mode:'closed'` 只挡
`element.shadowRoot`，挡不住改写 `Element.prototype.attachShadow`、事件冒泡/`composedPath()`、原型链污染。
它解决样式/选择器封装，不解决权限。

## 5. 供应链与完整性

- **SRI 对动态注入有效（实测）**：`s.src=…; s.integrity='sha256-…'; s.crossOrigin='anonymous'`，
  错 hash → `onerror`，对 hash → 执行。前提：走 CORS（同源或带 ACAO），不能是 inline/blob/data。
- 不适用：`import()`（无 integrity 参数）、inline、blob/data URL、import map。
- **实用分层**（宿主是信任根）：①安装时在宿主侧把 `id+version → sha256(code)` 记入台账；
  ②注入前在**宿主页面**用 `crypto.subtle.digest('SHA-256')` 复核（Chromium 152/156 支持；
  opaque 帧内也能算，但台账必须留在可信侧）；③需要作者身份时加 Ed25519：
  `importKey('raw',pub,{name:'Ed25519'})` + `verify`（Chrome 137+，本机 156 实测可用）。
  签名只解决"谁写的"，不解决"运行时越权"——运行时边界仍靠 sandbox+CSP。
- 重要认知：**SRI/hash 不能阻止已校验代码作恶**，只保证"跑的是我批准的那份代码"。

## 6. DSH / Electron 上下文（asar 取证）

- `dsh-app` 是 Electron 自定义协议，`protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }])`
  （`app.asar` 主进程 bundle）。未注册 `allowServiceWorkers`/`bypassCSP`；`standard+secure` ⇒ secure context。
- `protocol.handle(SCHEME, …)`：`host=app` 的 `/`、`/index.html`、`/assets/*` 等由 `serveWebDocument()`
  从 `app.asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist` 读文件返回，其余路径转发本机 Host。
- **`serveWebDocument()` 只设 `content-type`，不设任何 CSP header**；**打包 `dist/index.html` 里也没有
  CSP meta**（从 asar 解出的原文只有 charset/viewport/manifest/icon/module script）。
- ⇒ **今天 `dsh-app://app` 页面没有页面级 CSP**：好处是 srcdoc inline 能跑，坏处是没有父级兜底，
  组件侧必须自带 CSP；若日后 DSH 加 CSP，本方案需按第 3 节规则复核。
- 本会话是 Web GUI（`http://127.0.0.1:62616`），curl 返回 401（需 token），**Web 模式响应头未验证**；
  同一份 dist 由 Host 提供，预计同样无 CSP（未验证）。
- Electron `webPreferences`（各窗口一致）：`sandbox: true, contextIsolation: true, nodeIntegration: false,
  nodeIntegrationInWorker/SubFrames: false, webSecurity: true, webviewTag: false`。这里的 `sandbox` 是
  **渲染进程的操作系统级沙箱**，与 iframe 的 `sandbox` 属性互不相干：前者限制 renderer 能否直连 OS，
  后者限制文档 origin 能力，二者叠加才完整。
- 权限：桌面端 `installMicrophonePermissions()` 的 handler 对**非 media 权限一律 `callback(true)`**
  （media 仅主帧+音频+macOS 已授权时放行），即页面层权限很宽松；我们要挡的 pointer-lock/fullscreen/
  form/popup 是由 **iframe sandbox 属性**挡的，不依赖权限层。
- `file://` vs 自定义协议：DSH 不用 `file://` 加载应用页；若用，页面 origin 不稳定（各浏览器对 file URL
  的 origin、storage、fetch 规则另有一套），srcdoc 的 CSP 继承虽相同但没有"同源父页"，不建议。

## 7. 推荐的最小安全加载配方（伪代码）

```js
// ===== 宿主页面（当前全信任的 DSH 插件客户端）=====
const ALLOWED = new Map() // id -> sha256hex，安装时由宿主写入台账

async function mountUntrustedWidget(host, { id, code }) {
  // 1) 完整性：在可信侧校验，失败直接拒绝，绝不注入
  if (ALLOWED.get(id) !== await sha256Hex(code)) return reject('integrity')

  // 2) 固定模板 + 组件代码；CSP meta 必须在 head 最前，先于任何脚本
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",  // 内联引导；不给 unsafe-eval 则组件不能用 new Function
    "style-src 'unsafe-inline'",                 // 组件自带样式
    "img-src data:",                             // 只许内联图；要外链图就显式列域名
    "font-src data:", "media-src 'none'", "connect-src 'none'",
    "form-action 'none'", "base-uri 'none'",
    "frame-src 'none'", "worker-src 'none'", "object-src 'none'",
  ].join('; ')

  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')       // 永远不要加 allow-same-origin
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.setAttribute('allow', '')                       // 不授予任何 permissions policy
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block'
  iframe.srcdoc = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(policy)}">
<style>html,body{margin:0;height:100%;background:transparent}</style></head>
<body><div id="root"></div><script>(function(){${BOOT}/* 握手：ready → 收代码 → render/mount */})()</script>`

  // 3) 生命周期：握手 + 心跳 + 超时/无心跳换帧重建
  const t0 = Date.now(), state = { ready: false, lastBeat: t0, failures: 0 }
  const port = new MessageChannel().port1
  const onMsg = (e) => {
    if (e.source !== iframe.contentWindow) return   // opaque origin 下唯一可靠的身份校验
    if (e.origin !== 'null') return                 // 防御性：沙箱帧必须是 opaque
    const m = e.data; if (!m || m.v !== 1) return
    if (m.type === 'ready') { state.ready = true; port.postMessage({ type: 'load', id, code }) }
    if (m.type === 'beat') state.lastBeat = Date.now()
  }
  iframe.addEventListener('load', () => port.postMessage({ type: 'hello' })) // 对端 origin 是 "null"
  addEventListener('message', onMsg)

  const watchdog = setInterval(() => {
    if (!state.ready && Date.now() - t0 > 3000) return rebuild()               // 3s 未握手 → 判死
    if (state.ready && Date.now() - state.lastBeat > 15000) return rebuild()   // 15s 无心跳 → 判死
  }, 2000)

  // 4) 可见性：宿主用 IntersectionObserver 告知组件，别让组件靠 rAF/setInterval 自转
  new IntersectionObserver(([e]) => port.postMessage({ type: 'visible', visible: e.isIntersecting }))
    .observe(iframe)

  function rebuild() {
    clearInterval(watchdog); removeEventListener('message', onMsg); iframe.remove()
    if (state.failures++ < 2) return mountUntrustedWidget(host, { id, code })
  }
  host.appendChild(iframe)
}
```

配套硬规则：`sandbox` 永不加 `allow-same-origin`；`code` 只用字符串注入、不走网络；组件拿不到真实 token；
组件内自导航禁不掉 ⇒ 组件能看到的就等于能外泄的，**喂进去的数据必须"泄了也不心疼"**。

## 8. 未验证项清单

1. **Electron 44.7.0 / Chromium 152 与实测 Chrome 156 的差异**：OOPIF 进程隔离、定时器节流阈值、
   `navigate-to` 缺位、meta CSP 时序，均只在本机 Chrome 156 验证，需在 DSH 内跑同一套测试页复核。
2. **DSH Web 模式（`http://127.0.0.1:62616`）响应头有无 CSP**：curl 401（缺 token）未验证；
   只用 asar 证明了桌面端 `dsh-app://app` 无 CSP。
3. **Electron 是否关闭 site isolation / 是否对 `dsh-app` 会话加了额外 `webRequest` 头**：asar 中未见，
   只能运行时用 `chrome://process-internals` 或 CDP 确认。
4. **剪贴板**：有焦点、有用户手势时的真实授予未验证（headless 全是 "Document is not focused"）；
   Electron 非 media 权限默认放行是否会覆盖 opaque origin 的拒绝，未知。
5. **下载 `<a download>` 被拦的具体表现**（无声失败 or 告警）未单独实测，仅按规范与 sandbox token 推断。
6. **srcdoc 不受 `frame-src` 约束**仅在 Chrome 156 观测到，Chromium 152 与 Safari/Firefox 未验证，
   也不确定是规范要求还是实现选择。
7. **被 `remove()` 的卡死 OOPIF 进程回收耗时、连续重建是否堆积 renderer** 未测。
8. **meta CSP 生效时机**：只复现了"meta 之前的 inline 脚本会执行"，未测 meta 之前发起的外链请求是否漏过。
