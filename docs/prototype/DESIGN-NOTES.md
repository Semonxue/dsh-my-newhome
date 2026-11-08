# DESIGN-NOTES — 真实 DSH 尺寸/视觉考据（供 docs/prototype 校准）

考据对象：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，DSH Desktop **0.2.2-rc.1**（build commit `c59d10a`）。包都在 `dsh/node_modules/@deepseek-ai/`，下文用短名引用，行号均为 `lib/client.js`。

## 0. 证据边界（先读，避免抄错版本）

- 官方 token 权威来源：`dsh-client-ui-theme`，`client.js:1464`（字体/圆角）、`:1470`（明暗全部色值）、`:1482`（elevation/字号）。
- ⚠️ `docs/home.png` 与 `preview.html` 里的 token（`#131417` `#0e0f12` `#191b20` `#1f2228` `#4d6bfe`）**在已抽取的全部 client bundle + web 前端 dist 中 0 命中**，是插件自绘/旧版调色板，不是当前 DSH 官方值（`#131417` 只在 `preview.html:8` 出现）。截图按 1.5× 反推：侧栏 ≈ 313px（用户拖过，clamp 264–420），不是默认 280。
- 插件在真实 App 里只用 `var(--dsw-alias-*)`（`lib/client.js:1247+`，回退值才写死），所以原型改成官方 token 才更像当前 DSH。
- 未找到：`@deepseek-ai/dsh-client-ui-primitives` 未打进 asar（HeroFish/FishLogo 来自它），但 `dsh-web-frontend/dist/favicon.svg` 是同一只鲸鱼（50×50 path）；官方主页没有卡片/工作区卡（不存在，未找到）。

## 1. 布局与尺寸（可直接抄的数）

### 1.1 侧栏

| 项 | 值 | 证据 |
|---|---|---|
| 展开默认宽 | **280px** | `layout:264, :449`（`layoutInfo.sidebar === 0 ? 280 : …`） |
| 拖拽范围 | **264–420px** | `layout:40` `clampWidth(sidebar,264,420)` |
| 折叠 | <1024 自动折叠 | `layout:13` `SIDEBAR_AUTO_COLLAPSE=1024` |
| 折叠宽度 | **56px**（Win/Web 图标轨）/ **0**（macOS 整列隐藏，无轨） | `layout:267` `collapsedWidth = drawer‖darwin‖windowsTitlebar ? 0 : 56` |
| <768 | 变浮层抽屉，宽 `min(pref, vw-48)` + 遮罩 | `layout:250, :331` |
| 内边距 | `6px 8px`；行内边距变量 `12px`、label gap `6px` | `dsh-client-ui-sidebar:116` |
| 顶部 | topStrip **52px**（mac 红绿灯区）+ logoRow **60px**（`padding:8px 0 8px 8px`） | 同上 |
| 品牌字 | **18px/24px 600，letter-spacing .04em**；鱼标 ~22–24px | 同上 `brandName` |
| 新会话按钮 | **高 38px，圆角 12，`.5px` border-l3，margin `0 4px 10px`，14px/22 500** | 同上 `newSession` |
| 工作区行 / 会话行 | **34px / 32px，圆角 12，padding `0 8px`，gap 6** | `dsh-client-ui-workspace:1955` |
| 面板行 | min-height 36px，圆角 12 | `sidebar:116` `panelRow` |
| 分隔与底色 | 右侧 `.5px solid border-l3`；`specific-sidebar-fill` = 浅 `#f9fafb` / 深 `#1b1b1c` | `layout:74`；`theme:1470` |
| macOS 底色 | 半透明 + 蓝紫渐变 `linear-gradient(#7a9bf01a, #7a9bf000 35%, #8f89b800 68%, #8f89b817)`（暗色 `#7a9bf014/#8f89b812`） | `layout:74` |

### 1.2 Composer（输入框）

- 宽度公式（**别写死 760**）：内容宽 `W = clamp(680, 0.64 × 中栏宽, 920)`，卡片 `= W + 32`。1280/1440/1920 视口（侧栏 280）→ **712 / 774 / 952px**。证据 `dsh-client-ui-conversation:20057`。
- 卡片：**圆角 28**（`--dsw-radius-panel`）、**无 border**、底色 `specific-input-major`（浅 `#fff` / 深 `#2c2c2e`）、阴影 `elevation-soft`、`padding-top:8px` + 内部 `gap:12px`。证据 `conversation:21701` `.JZLxKW_card`。
- 文本区：`padding:4px 8px 0 14px`、min-height **36**（hero 态 **52**）、最大高 **336**（超出滚动，右侧留 4）。
- 底部控制行：`padding:2px 8px 6px`、`gap:12px`（容器 ≤560 时 8）。
- 控件：加号 **28×28 圆形**（底色 `specific-selector`）；模型选择 **高 28、圆角 8、13px/20 500、padding `0 4px 0 8px`、max-width 360**；发送 **34×34 圆形**，底色 `button-info-fill`（深 `#7aaaff` / 浅 `#4176e6`），白图标，`translateY(-2px)`。证据 `conversation:21701`、`dsh-client-ui-model-selection:1063`。
- hero 态外层：左右 clearance **16**、stack gap **6**（hero 8）、底部留白 **32**。证据 `conversation:20057`。
- 工作区选择**不在卡内**：hero 专属独立行，位于标语与卡片之间（DOM：HeroShell → heroWorkspaceRow → dock → InputBar，`conversation:20571-20581`）；行 `padding:0 16px 0 20px; margin-top:4px; gap:2px`，chip **高 28、圆角 8、13/20 500、padding `0 8px`**，folder 16 + chevron 12；右侧 `heroOptions` 用 `margin-left:auto`。
- 模型选择在卡底行**右侧**（`trailing > standardControls`，发送钮左边）；模式（权限档/Plan）在底行**左侧**（`tools > modes`，加号右边）；发送最右。证据 `conversation:22068-22110`。

### 1.3 Hero（新会话首页）

- 结构只有三件：**鲸鱼 34px + 标语 + 「预览版」徽标**，横向居中（`conversation:20434-20463`、`20314`）。
- 标语：**26px / 32px / 500**，行内 gap `12px 10px`，`letter-spacing:0`（不是 28/600/.5px）。
- 徽标：12px/18 mono、padding `1px 7px 0`、圆角 999、`.5px` 描边、底色 `state-business-tertiary`。
- 官方首页**没有卡片**；卡片/deck 是插件自建（`lib/client.js:1240-1360`：3 列 grid、`gap:8px`、卡 `min-height:60px`、`padding:10px 13px`、圆角 12、头像 28/圆角 9、组标题 11px/500/.4px）。

## 2. 主题真值（浅 / 深，官方 0.2.2-rc.1）

| 语义 | 浅色 | 深色 | 对应原型变量 |
|---|---|---|---|
| 页面底 bg-base | `#ffffff` | `#151517` | `--bg-base` |
| 侧栏/外壳 | `#f9fafb` | `#1b1b1c` | `--bg-shell` |
| layer-1（面板/卡） | `#ffffff` | `#232324` | `--bg-1` |
| layer-2（composer/菜单） | `#ffffff` | `#2c2c2e` | `--bg-2` |
| layer-3 | `#ffffff` | `#353638` | `--bg-3` |
| 选择器底 | `#f5f6f7` | `#353638` | `--surface-2` |
| 主/次/弱文字 | `#0f1115` / `#61666b` / `#81858c` | `#f9fafb` / `#cfd3d6` / `#adb2b8` | `--tx-1/2/3` |
| caption | `#adb2b8` | `#81858c` | `--tx-3`（弱一档） |
| border l1/l2/l3/l4 | `#0000000a` / `#1a` / `#1f` / `#29` | `#ffffff0f` / `#1f` / `#29` / `#33` | `--bd-1/2/3` |
| hover 底 | `#2631480f` | `#ffffff14` | `--surface` 系 |
| brand（单色！） | `#0f1115` | `#f9fafb` | — |
| 强调蓝 | `#4176e6`（hover `#7aaaff`） | `#7aaaff`（hover `#4176e6`） | `--brand` / `--brand-2` |
| 气泡 | `#edf3fe` | `#2c2c2e` | — |
| 成功/警告/错误 | `#22c55e` / `#f59e0b` / `#ec1313` | 同 / 同 / `#f25a5a` | `--green/amber/red` |
| 菜单 | `#fcfdfeb3`（mac `#f8f9faf0`） | `#303136a3`（mac `#303136f0`） | 抽屉/菜单 |

- **圆角尺度**：`4 / 8 / 12 / 16 / 20 / 28px`（xs/sm/md/lg/xl/panel），且全局 `corner-shape: superellipse(1.5)`（真 DSH 是“超椭圆”圆角，视觉上更方）。`theme:1464, :1467`
- **阴影**：`elevation-soft = 0 0 0 .5px border-l4, 0 4px 16px #00000008, 0 0 24px #00000008`（不用大投影）。`theme:1482`
- **字体**：正文 `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif`；代码 `"SF Mono","JetBrains Mono","Fira Code",Consolas,…,"PingFang SC","Microsoft YaHei"`；品牌字 `Montserrat, …`。`theme:1464`
- **字号级**：24/32·600、20/28·500、16/24·400、14/22、13/20、12/18、11/14；正文内容 14/24。`theme:1482`
- **Logo 真值**：官方品牌标记是**单色鲸鱼**（`currentColor`），hero 宽 **34px**、sidebar ~22–24px，无色块无渐变（`conversation:20406-20427`；`dsh-client-ui-brand-official:15-17`；`favicon.svg`）。紫色渐变只在 onboarding：`#2a2fb6 → #8b76f6 → #c5c0ff`（`theme:1476`）；插件截图里的紫方块对应这组渐变，可按需取用但**不是** DSH 主 logo。

## 3. 对 docs/prototype 的可执行修正（按收益排序）

1. **`styles/base.css:16` `--sidebar-w: 232px` → `280px`**；折叠态宽度 **0**（macOS 语义：整列隐藏、内容区左让位；若要保留图标轨用 56px）；视口 <1024 时自动折叠、<768 变抽屉（带遮罩）。
2. **暗色 token 全量换官方值**（`base.css:25-45`）：`#131417→#151517`、`#0e0f12→#1b1b1c`、`#191b20→#232324`、`#1f2228→#2c2c2e`、`#262a31→#353638`、`#e9eaee→#f9fafb`、`#a8aeba→#cfd3d6`、`#767c88→#adb2b8`、`#24272e→#ffffff0f`、`#2f333b→#ffffff1f`、`#3d434e→#ffffff29`。
3. **浅色 token**（`base.css:66-86`）：`#f6f7fa→#ffffff`、`#eef0f5→#f9fafb`、`#f2f4f8→#ffffff`、`#e8ebf1→#ffffff`；文字 `#181b21→#0f1115`、`#5a6170→#61666b`、`#8a909c→#81858c`；描边 `#e7e9ef→#0000000a`、`#d9dce4→#0000001a`、`#c9cdd7→#0000001f`。注意：**官方浅色 layer1–3 全是纯白**，层次靠 `.5px` 描边 + 阴影，不要用灰块。
4. **`--brand` `#4d6bfe` → `#7aaaff`（深）/#4176e6（浅）**，`--brand-2` 用 `#5686fe`，`--brand-soft: color-mix(in srgb, var(--brand) 14%, transparent)`；hover 态两色互换。
5. **圆角**：`--r-xl:22px→20px`，新增 `--r-panel:28px`；`.cmp-card` 用 28，`.w-card` 保持 16 或改 12（DSH 面板多为 12，大面板 16）。
6. **`styles/composer.css:8-21` `.cmp-card`**：`border:0`、`border-radius:28px`、`padding:8px 0 0`、`background:var(--bg-2)`、`box-shadow: 0 0 0 .5px var(--bd-3), 0 4px 16px #00000008, 0 0 24px #00000008`；去掉 36px 外投影和 3px focus ring（官方只做底色 hover）。
7. **输入区**：`font-size:13px→14px`、`line-height:24px`、`padding:4px 14px 0`、`min-height:52px`、`max-height:336px`；placeholder 用 caption 色。
8. **底行/控件**：`padding:2px 8px 6px`、`gap:12px`；chip 类控件 `25px→28px 高、border-radius:8px（不是胶囊）、13px/20 500、padding:0 8px`；加号 `26→28` 圆形；**发送 `28→34px` 圆形、背景 `--brand`、`transform:translateY(-2px)`**。
9. **重排选择器行**：工作区 chip 从卡内底行**移出**，放到卡片上方独立一行（高 28，行 `padding:0 20px`，`margin:4px 0 8px`，左对齐）；卡内底行只留「+ / 模式（左）· 模型 / 发送（右）」。
10. **Hero 与画布**：标语 `font-size:28px→26px`、`font-weight:600→500`、`line-height:32px`、`letter-spacing:.5px→0`；Logo 若保留紫色 squircle，用官方 onboarding 渐变 `#2a2fb6→#8b76f6→#c5c0ff` + `corner-shape:superellipse(1.5)`；`--canvas-max:1080px→952px`，画布宽改 `min(952px, max(712px, calc(64% + 32px)))`，格宽 = 画布宽/24（1280 → 29.7px，1920 → 39.7px，CONTRACT 的「21–39px」偏小，建议改「30–40px」）。
11. **卡片与组标题**：卡片圆角 16→12、内边距 `12px 14px→10px 13px`、最小高 60；组标题 `12px/600→11px/500/.4px`，deck `gap:8px` 三列——这三项直接对齐插件真实渲染（`lib/client.js:1247-1310`）。

## 4. 证据索引

- 侧栏宽度/折叠：`dsh-client-ui-layout/lib/client.js:13, :39-48, :250, :264, :267, :331, :449`；样式 `layout:74`
- 侧栏 UI：`dsh-client-ui-sidebar/lib/client.js:116`（root/newSession/logoRow/panelRow）；工作区行 `dsh-client-ui-workspace/lib/client.js:1955`
- Composer 尺寸/配色：`dsh-client-ui-conversation/lib/client.js:20057`（宽高变量/hero 行）、`:21701`（card/input/row/select/send）、`:22068-22110`（底行插槽顺序）
- Hero/鲸鱼：`conversation:20314`（CSS）、`:20406-20427`（HeroFish 34px,currentColor）、`:20434-20463`（结构）
- 主题/字体/圆角/阴影：`dsh-client-ui-theme/lib/client.js:1464, :1467, :1470, :1476-1482`
- 模型选择控件：`dsh-client-ui-model-selection/lib/client.js:1063`
- 品牌槽：`dsh-client-ui-brand-official/lib/client.js:15-17, :36-39`；鲸鱼 path：`dsh-web-frontend/dist/favicon.svg`
- 插件卡片/deck：`lib/client.js:1240-1360`（3 列 grid、卡 60px/圆角 12、小组件 64px/圆角 12）；`preview.html:8-23` 是被截图沿用的 mock token。
