# 同类产品调研：组件的发行与信任隔离

> 面向 DSH「自定义主页」组件模型（单文件 JS + `render`/`mount`、24 栏自由网格、主题 token）。
> 调研时间：2026-11。原则：结论尽量来自官方文档；拿不到一手来源的写「未验证」。
> 结论先行：**行业里没有「既完全开放又安全」的银弹，主流只有两条路——全信任脚本（靠发行端兜底）或强隔离 iframe/sandbox（靠宿主 API 兜底）。**

## 0. 五条核心结论

1. **全信任不是「没设计」，而是把安全前移到发行端**：Grafana 用签名、Raycast 用「全部开源 + 人工 review + 禁远程代码」、Obsidian 用「自动扫描 + 安全评分 + 默认受限模式」、Chrome 用「商店审核 + 定期复审」。
2. **强隔离的共性 = 场景 API 与浏览器 API 分离 + 消息传递**：Figma 主线程只有受限 JS、UI 走 `figma.showUI` 的 iframe；VS Code webview 是 iframe + `postMessage`；Chrome 把 `eval` 限制在 sandboxed iframe 里。
3. **权限模型正在从「安装时全给」转向「声明式 allowlist + 运行时授权」**：Figma `networkAccess.allowedDomains`、Chrome `optional_permissions`、VS Code Workspace Trust（按来源分级信任）。
4. **签名/审核解决「篡改与劣质」，不解决「作者作恶」**：Grafana 签名只保证包没被改；Chrome 商店审核过的扩展仍可在后续更新里变坏（The Great Suspender）。
5. **真实事故的共同模式 = 所有权转移/供应链投毒 + 自动更新**：The Great Suspender（卖给第三方后投毒）、GlassWorm（VS Code/Open VSX 恶意扩展）、PhantomPulse（Obsidian 插件投递 RAT）。对 DSH 来说，**更新通道与作者身份，比沙箱更值得先设计**。

## 1. 逐产品笔记

### 1.1 Grafana 插件（签名 + 可选前端沙箱）

- **载体**：`plugin.json` + `dist/` 前端 bundle（SystemJS 加载）；含后端组件的插件另带 Go 二进制（与 Grafana 的进程关系本轮未细核，标「未验证」）。
- **信任模型**：面板插件历史上**与 Grafana 同页面执行，没有 iframe**；v11.5 起提供可选 **Plugin Frontend Sandbox**（用 near-membrane 近似 ShadowRealm 的独立 JS realm，**默认关闭**），用于阻止插件改 Grafana UI、改全局对象、干扰其他插件。
- **权限/数据**：面板通过 React props 拿到 `PanelData`/data frames（**同进程 JS 对象，不是 postMessage**）。任务描述里的「panel iframe sandbox + postMessage」与官方实现不符，特此修正。
- **分发/审核**：私有 / Community / Commercial 三种签名级别；启动时校验，`Unsigned` / `Invalid` / `Modified` 一律不加载并写 WARN；Grafana Cloud 不允许 unsigned；开发模式可放行。
- **更新/卸载**：更新=替换插件目录里的 `dist`（catalog 提供版本，运维手动/自动化升级）；卸载=从插件目录删除并重启，无残留注册表。
- **规模**：官方 plugin catalog 是最大的可观测性插件集合（具体数量未验证）；生态教训主要来自「未签名插件被拦」与「沙箱默认关」。
- **教训**：签名防篡改不防恶意；沙箱是 2025 年才补的、且默认关——**同页面执行是历史债**。
- 来源：[Plugin signatures](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-sign/)、[Frontend Sandbox 发布说明](https://grafana.com/whats-new/2025-01-14-plugin-frontend-sandbox/)、[sandbox README](https://github.com/grafana/grafana/blob/main/public/app/features/plugins/sandbox/README.md)

### 1.2 Home Assistant：HACS + Lovelace 自定义卡片

- **载体**：单个 JS/ES module 文件（放 `/local/`，或 HACS/Marketplace 从 GitHub 仓库装）；卡片是自定义元素（`customElements.define`），实现 `setConfig` / `hass` / `getGridOptions`。
- **信任模型**：**与前端同页面、无沙箱**。HACS/Marketplace 只是「目录 + 安装器」，不提供安全边界；2026.11 起 HACS 已内置为 Home Assistant 官方 Marketplace。
- **权限/数据**：卡片拿到完整 `hass` 对象——全屋状态、`callService`、`callApi`（带用户认证）、`fetchWithAuth`（带 access token）。**等于用户会话权限**。
- **安装/分享**：粘 GitHub 仓库 URL 进 HACS，或手放文件 + YAML 注册资源；无人工审核。
- **版本/更新/卸载**：由 GitHub release/tag 驱动，HACS 检查更新；卸载=在 HACS 删除仓库或手动删文件 + 移除资源注册。
- **规模**：Home Assistant 是最大的开源智能家居生态，自定义卡片/集成数量以千计（未验证具体数）；教训是「市场/目录不是安全边界」。
- **教训**：目录/市场不等于安全边界；生态事故少主要靠社区规模与监督，不是技术隔离。
- 来源：[Custom cards](https://contributors.home-assistant.io/frontend/custom-ui/card/)、[hass object](https://contributors.home-assistant.io/frontend/reference/hass-object/)、[HACS Marketplace](https://hacs.xyz/docs/marketplace/)

### 1.3 Raycast Extensions

- **载体**：npm 包 + React API（TS/JSX），Store 安装；扩展源码全部开源在 `raycast/extensions`。
- **信任模型**：单个子 Node.js 进程，每个扩展跑在独立 v8 isolate（worker thread）里，与 Raycast 只通过文件句柄 + 薄 RPC 通信，RPC 只暴露定义好的 API；但**OS 层不再沙箱**——文件/网络/Node 能力都是全的。
- **权限/数据**：无细粒度权限；敏感值走 *password preference*，存本地加密数据库、仅该扩展可读；直接访问 Keychain 的扩展会被拒。
- **分发/审核**：开源 + Raycast/社区共同 review + Store guidelines + CI 校验（schema/assets/构建）；拒绝不可审计二进制，第三方二进制必须可信来源 + hash。
- **更新/卸载**：应用和扩展都自动更新（官方明确把「减少过期漏洞」当作安全特性）；卸载=在 Store/设置里移除，本地记录删除。
- **规模**：Store 扩展数量以千计（未验证具体数），靠开源仓库做规模化代码审查。
- **教训**：「开源 + 人工审核 + 禁远程代码」能在全信任前提下把风险压到可接受；但依赖审核人力，且**自动更新会绕过初次审核**。
- 来源：[Security](https://developers.raycast.com/information/security)、[Prepare an Extension for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store)

### 1.4 Obsidian 社区插件

- **载体**：`main.js` + `manifest.json` + `styles.css`，放进 vault 的 `.obsidian/plugins/`；社区目录安装，或用 BRAT 从 GitHub 装 beta/未上架版本。
- **信任模型**：**全信任**。官方原话：技术上无法可靠限制插件权限，插件继承 Obsidian 的访问级别——可读本机文件、联网、安装程序。
- **安全开关**：默认 **Restricted Mode**（不执行第三方代码），用户手动关闭才生效。
- **分发/审核**：每个版本自动扫描（漏洞/质量/恶意），目录页给「安全评分卡」；热门/精选/被举报的插件人工复审；遵循开发者政策。
- **更新/卸载**：目录内更新；BRAT 提供「跟随 GitHub 分支」的 beta 通道；卸载=关插件 + 删 `.obsidian/plugins/<id>` 目录。
- **规模**：社区目录约 8,000+ 插件（2026-09 论坛统计，非官方，标「未验证」）。
- **教训**：2026-04 CSA 报告披露 **PhantomPulse** 通过 Obsidian 插件投递 RAT——全信任 + 第三方源安装是真实攻击面。
- 来源：[Plugin security](https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Plugin%20security.md)、[BRAT](https://github.com/TfTHacker/obsidian42-brat)、[PhantomPulse 报告](https://labs.cloudsecurityalliance.org/research/csa-research-note-phantompulse-rat-obsidian-20260416-csa-sty/)

### 1.5 VS Code 扩展与 Webview

- **载体**：VSIX（`package.json` + `main.js`），Marketplace 安装，也可旁加载 VSIX。
- **信任模型**：扩展宿主是独立进程（local Node / remote / web worker 三种），**有文件、命令、依赖安装权限**；`extensionKind` 决定跑在哪。Webview 是 iframe：默认禁 JS，需 `enableScripts` + CSP + `localResourceRoots`；webview 与扩展用 `postMessage` / `acquireVsCodeApi` 通信，webview **拿不到 VS Code API**。
- **权限模型**：无逐扩展权限声明；用 **Workspace Trust**（`untrustedWorkspaces` 声明 `true/false/limited`）按「工作区是否可信」分级禁用能力。
- **分发/审核**：publisher + `vsce` 发布，门槛低；主要靠恶意软件扫描与事后下架；verified publisher 需域名 TXT 验证。
- **更新/卸载**：自动检查更新，可在 Extensions 视图卸载；`vsce unpublish` 只下架、已装副本仍留在用户机器上。
- **规模**：Marketplace 有数万个扩展（2026-08 第三方统计约 6.4 万个，未官方核实）。
- **教训**：GlassWorm（2025-11/12）通过 VS Code 与 Open VSX 的恶意扩展窃取 GitHub token / 加密钱包——**低门槛市场 + 自动更新是供应链攻击首选**；Workspace Trust 是务实的「按来源分级信任」。
- 来源：[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)、[Webview API](https://code.visualstudio.com/api/extension-guides/webview)、[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)、[Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)、[GlassWorm](https://www.thaicert.or.th/en/2025/12/04/glassworm-returns-with-over-24-malicious-extensions-targeting-developers-via-vs-code-and-open-vsx/)

### 1.6 Figma 插件（沙箱 + manifest 权限）

- **载体**：`manifest.json` + `code.js`（主线程）+ 可选 `ui.html`；发布到 Community，按 `id` 更新。
- **信任模型**：主线程跑在**极简 JS sandbox**（无 DOM / fetch / XHR / setTimeout）；需要浏览器 API 时用 `figma.showUI()` 开 iframe，两者**消息传递**。等于「能改文档，不能偷页面」。
- **权限**：manifest 声明 `networkAccess.allowedDomains`（默认 `["none"]`，`"*"` 必须写理由）、`documentAccess: "dynamic-page"`、`permissions`（currentUser/activeUsers/payments/teamLibrary 等）；允许域名会显示在 Community 页。
- **分发/审核**：提交 Community 需人工 review（质量/信任安全/商业/法律），**重大更新需重审**；内部使用可发私有组织插件。
- **更新/卸载**：按 plugin `id` 发布新版；用户端是否可锁定旧版本，本次文档未说明（标「未验证」）；卸载=在 Figma 里移除插件，Community 描述可留档。
- **规模**：Community 插件数以千计（未验证具体数）；审核人力是主要瓶颈。
- **教训**：「场景 API 与浏览器 API 分离」是隔离的核心；iframe 里再叠加域名白名单，才能同时防「偷数据」和「乱联网」。
- 来源：[How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/)、[Manifest](https://developers.figma.com/docs/plugins/manifest/)、[Review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)

### 1.7 Chrome 扩展（Manifest V3）

- **载体**：CRX 包 + `manifest.json`；Web Store 分发，或开发者模式/企业策略旁加载。
- **信任模型**：扩展页面 `chrome-extension://` 独立 origin；content script 在 isolated world；MV3 **禁止远程代码**（所有逻辑必须打包进扩展），CSP 把 `script-src/object-src/worker-src` 限死；`eval`/`new Function` 只允许在 sandboxed iframe。
- **权限**：`permissions` / `host_permissions` 安装时声明并显示警告；`optional_permissions` / `optional_host_permissions` 运行时申请；`file://` 和 incognito 需单独开启。
- **分发/审核**：人工 + 自动混合；新开发者、危险权限、大改版会被重点审；已上架扩展**定期复审**；警告期 7–30 天，恶意软件直接强制禁用且不可重新启用。
- **更新/卸载**：自动更新（开发者模式可关闭）；卸载=在 `chrome://extensions` 移除，恶意判定可被 Google 强制卸载。
- **规模**：Web Store 扩展数量以十万计（未验证具体数）；是「审核 + 事后执法」模式的代表。
- **教训**：**The Great Suspender**（2021，200 万用户）作者把扩展卖给第三方 → 后续版本加入跟踪和远程脚本 → Google 以 malware 强制卸载。**所有权转移 + 自动更新才是最大风险**。
- 来源：[What is MV3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)、[Improving security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)、[Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)、[Review process](https://developer.chrome.com/docs/webstore/review-process)、[The Great Suspender](https://www.bleepingcomputer.com/news/security/the-great-suspender-chrome-extensions-fall-from-grace/)

### 1.8 Übersicht / Scriptable（桌面/移动小组件）

- **Übersicht**：macOS 桌面 widget = JSX 文件，导出 `command`（**shell 命令**）+ `refreshFrequency` + `render`，放在本机 widgets 目录；无商店、无审核，widget 网站 / GitHub 分享，官方免责声明「at your sole risk」。
- **Scriptable**：iOS 上纯 JS 脚本，通过桥接直接调原生 API（日历、文件、网络、快捷指令）；脚本就是磁盘上的 `.js` 文件，靠文件/iCloud/分享传播；App Store 只审 app 本身，**没有脚本级权限模型**（未找到官方脚本沙箱说明，标「未验证」）。
- **更新/卸载**：两者都没有市场式更新，替换/删除本地文件即完成；无回滚、无版本元数据。
- **规模**：个人向工具生态，社区 widget 目录靠 GitHub/官网（Übersicht）或脚本分享（Scriptable），无集中审核。
- **教训**：个人向小组件生态默认「本机全信任 + 社区分享」，安全靠用户自觉；只适合自用，不适合面向大众的组件市场。
- 来源：[Übersicht](https://tracesof.net/uebersicht/)、[Scriptable](https://scriptable.app/)

### 1.9 Notion / Indify（URL + iframe 嵌入型）

- **载体**：一个 URL/iframe。Notion 通过 Iframely 支持 1,900+ 域名的 embed；Indify 等第三方托管 widget，用户只需粘贴 URL。
- **信任模型**：浏览器 iframe 同源策略隔离，拿不到宿主 DOM；但没有额外权限声明，iframe 内仍可联网、可看到访问者 IP（Notion 文档明示）。
- **更新/卸载**：更新由第三方 widget 服务自己完成（宿主无版本概念）；卸载=删掉 embed block / URL。
- **教训**：最轻的第三方组件形态 = URL + iframe，无需打包/审核；代价是主题/交互集成弱，且第三方可观测用户。
- 来源：[Notion embeds](https://www.notion.com/help/embed-and-connect-other-apps)

## 2. 横向对比表

| 产品 | 载体 | 隔离级别 | 权限模型 | 分发渠道 | 审核 / 版本 | 典型失败模式 |
|---|---|---|---|---|---|---|
| Grafana | 前端 bundle（+Go 后端） | 同页面（可选独立 JS realm，默认关） | 无细粒度；签名级别 + 沙箱开关 | 官方 catalog / 私有 | 签名校验，catalog 提交 | 签名只防篡改；未签名被拦 |
| HA / HACS | 单 JS 文件 / GitHub 仓库 | 无（同页面 custom element） | 完整 `hass`，含用户 token | HACS、2026.11 起官方 Marketplace | 目录 + 自动检查，无安全审核 | 恶意卡片可读全屋数据、调服务 |
| Raycast | npm 包（React） | 独立 v8 isolate + RPC，无 OS 沙箱 | 无权限声明；password preference 隔离存储 | 内置 Store / 网页 Store | 开源 + 人工 review + CI | 自动更新绕过初次审核 |
| Obsidian | 单 JS 文件 | 无（全信任） | 继承宿主全部权限 | 社区目录 / BRAT | 自动扫描 + 评分卡 + 部分人工 | 插件投递 RAT（PhantomPulse） |
| VS Code | VSIX | 扩展独立进程；webview iframe | 无逐扩展权限；Workspace Trust 分级 | Marketplace / 旁加载 | 低门槛发布 + 事后扫描 | 恶意扩展窃 token（GlassWorm） |
| Figma | manifest + JS + HTML | 主线程 sandbox + UI iframe | manifest 域名 allowlist + 能力 permissions | Community（或私有） | 人工 review，重大更新重审 | 无（隔离较彻底），风险在 iframe 内容 |
| Chrome MV3 | CRX + manifest | 独立 origin；content script 隔离世界 | 声明式 permissions + 运行时 optional | Web Store / 旁加载 | 人工+自动、定期复审、强制禁用 | 所有权转移 + 自动更新（Great Suspender） |
| Übersicht | JSX 文件 | 无（本机执行 shell） | 无 | 社区分享 | 无 | 任意命令执行 |
| Scriptable | JS 文件 | 无（调用 iOS 原生 API） | 无脚本级权限（未验证） | 文件 / iCloud | 仅 app 层 App Store 审核 | 脚本可读系统数据 |
| Notion / Indify | URL / iframe | 浏览器 iframe | 无显式权限 | 粘贴 URL | 无 | 第三方可观测访问者 |

**可以横向读出的规律**：
- 隔离越强（Figma/Chrome/VS Code webview），宿主 API 的「接口设计」成本越高；
- 全信任生态（Obsidian/HA/Übersicht）要把成本花在**发行端 + 默认安全模式**上；
- 商店型（Raycast/VS Code/Chrome）审核再严，也挡不住「装机后作者变坏」，所以**版本锁定 / 可回滚 / 作者转移告警**是必要补充。

## 3. 对「DSH 自定义主页组件」的启示

### 值得抄的 3 条

1. **抄 Figma 的「场景 API / 渲染 API 分离」**：组件只能拿到宿主显式给的 `ctx`，不直接摸 DOM、不直接 `fetch`、不拿宿主凭证。当前 CONTRACT 的 `render(ctx)` + `mount(root, ctx)` 已经是好起点，下一步把「开工作区 / 读用量 / 打开设置」做成 `ctx.api.*` 白名单，而不是让组件自己 `document.querySelector` 或 `fetch`。理由：隔离不一定要 iframe，**先收口能力面**就能挡住大部分越权。
2. **抄 Grafana 的「签名 + 分级」**：组件包带 manifest（id / version / 作者 / 声明权限 / 内容 hash），区分 `core`、`verified`、`community`、`private`；未签名或 hash 不符默认拒绝加载、可显式放行（并每次都警告）。理由：签名能保证「装的和审的是同一份」，也给「私有组件/本地开发」留了口子。
3. **抄 Obsidian 的「默认安全模式 + 目录透明」**：首次安装第三方组件默认进入受限模式（无网络、无宿主 API、仅纯渲染），组件列表展示来源、权限、更新时间、安全评分，支持一键禁用/回滚版本。理由：用户需要「装之前能判断、装之后能关掉」。

来源：[Figma How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/)、[Grafana signatures](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-sign/)、[Obsidian plugin security](https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Plugin%20security.md)

### 该避开的 3 个坑

1. **别同时做「全信任 + 自动更新 + 低门槛市场」**：VS Code 与 Chrome 的事故都指向这个组合；一旦作者卖号/被投毒，用户会在无感知的更新里中招。至少要做到版本锁定、更新前二次确认、作者变更告警。
2. **别把「签名」当成安全全部**：Grafana 的签名只证明包没被改，插件仍可在同页面为所欲为；签名必须叠加权限声明与运行时能力白名单，否则只是「有仪式感的完整性校验」。
3. **别在主页面同一 JS 上下文里跑第三方组件，却对外宣称「组件安全」**：Obsidian/HA 的官方文档都承认「无法可靠限制插件权限」；DSH 若开放第三方组件，单文件 `<script>` + 全局 `window.DSH_WIDGETS_*` 就是全信任模型，要么明确告知用户，要么改用 iframe/Worker/独立 realm，并通过 CSS 变量 + postMessage 传主题与数据。

来源：[VS Code publishing/security](https://code.visualstudio.com/api/extension-guides/webview)、[Chrome review process](https://developer.chrome.com/docs/webstore/review-process)、[Grafana signatures](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-sign/)、[HOME Assistant hass object](https://contributors.home-assistant.io/frontend/reference/hass-object/)

## 4. 未验证 / 存疑清单

- **Grafana 后端插件的进程模型**（独立进程 + gRPC）本轮未抓到一手文档，仅前端沙箱与签名已核实。
- **Grafana 前端沙箱默认关闭**：依据是 what's-new 的「disabled by default」，未在多版本 docs 中交叉核对。
- **Raycast 的隔离边界**：官方明说「OS 层面不进一步沙箱」；「扩展间隔离」仅指 v8 isolate / 存储 API，跨扩展文件读取是否可能未验证。
- **Figma 主线程 sandbox 的实现技术**（QuickJS/自研）官方文档只写「minimal JavaScript environment」，未说明引擎。
- **Scriptable 脚本沙箱**：只确认「native APIs bridged to JS」，是否有运行时限制未找到官方说明。
- **Obsidian 插件数量**（约 8,000+，2026-09 论坛统计）非官方数据，仅作规模参考。
- **DSH 自身**是否已有组件签名、权限或组件市场设计：本仓库当前只有 `docs/prototype/CONTRACT.md`，未发现相关实现（本任务范围外）。

## 5. 参考链接（按产品）

- Grafana：[Plugin signatures](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-sign/) · [Frontend Sandbox](https://grafana.com/whats-new/2025-01-14-plugin-frontend-sandbox/) · [sandbox README](https://github.com/grafana/grafana/blob/main/public/app/features/plugins/sandbox/README.md) · [Plugin tools](https://grafana.com/developers/plugin-tools/)
- Home Assistant：[Custom cards](https://contributors.home-assistant.io/frontend/custom-ui/card/) · [hass object](https://contributors.home-assistant.io/frontend/reference/hass-object/) · [HACS Marketplace](https://hacs.xyz/docs/marketplace/)
- Raycast：[Security](https://developers.raycast.com/information/security) · [Prepare for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store)
- Obsidian：[Plugin security](https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Plugin%20security.md) · [BRAT](https://github.com/TfTHacker/obsidian42-brat) · [PhantomPulse](https://labs.cloudsecurityalliance.org/research/csa-research-note-phantompulse-rat-obsidian-20260416-csa-sty/)
- VS Code：[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host) · [Webview](https://code.visualstudio.com/api/extension-guides/webview) · [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust) · [Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) · [GlassWorm](https://www.thaicert.or.th/en/2025/12/04/glassworm-returns-with-over-24-malicious-extensions-targeting-developers-via-vs-code-and-open-vsx/)
- Figma：[How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/) · [Manifest](https://developers.figma.com/docs/plugins/manifest/) · [Review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)
- Chrome：[MV3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) · [Improving security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) · [Permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) · [Review process](https://developer.chrome.com/docs/webstore/review-process) · [Great Suspender](https://www.bleepingcomputer.com/news/security/the-great-suspender-chrome-extensions-fall-from-grace/)
- 桌面/移动小组件：[Übersicht](https://tracesof.net/uebersicht/) · [Scriptable](https://scriptable.app/)
- iframe 嵌入型：[Notion embeds](https://www.notion.com/help/embed-and-connect-other-apps)
