# 组件库契约（widget contract）

这是 `docs/prototype/` 静态原型的组件作者必读文件。原型模拟 DeepSeek Harness
（下称 DSH）的新会话主页，画布是 24 栏自由网格，组件库在右侧抽屉里，组件可以拖进
画布、缩放、移动、删除，并随深/浅色主题与侧栏开合实时适配。

- 纯静态：只用 HTML + CSS + 原生 JS，无构建、无框架、无网络请求、无外部字体/图片。
- 文件通过 `<script>` 直接加载，所有数据写在 JS 里。
- 视觉基准：`docs/home.png`（插件效果截图）、`preview.html` 中的 token。
- 目标尺寸：桌面浏览器 1280–1920 宽；**1 格 = 1 列 × 30px 行高**，列宽随画布宽度在约
  21–39px 之间变化，组件按格数给尺寸（垂直高度不随左右栏开合变化）。

---

## 1. 文件与全局变量

两位作者各写两个文件，互不越界：

| 作者 | JS（写） | CSS（写） | 导出的全局变量 |
|---|---|---|---|
| base-plan 作者 | `js/widgets-plan.js` | `styles/widgets-plan.css` | `window.DSH_WIDGETS_BASE_PLAN` |
| pad-pc 作者 | `js/widgets-padpc.js` | `styles/widgets-padpc.css` | `window.DSH_WIDGETS_PAD_PC` |

**不要修改** `index.html`、`styles/base.css`、`styles/composer.css`、`js/app.js`、
`js/composer.js`、`CONTRACT.md`。发现契约问题在交付说明里写出来，不要改别人的文件。

每个全局变量是一个数组：

```js
window.DSH_WIDGETS_BASE_PLAN = [
  {
    id: 'workspace-card',          // 必填，kebab-case，全局唯一，见第 4 节表格
    name: '工作区卡片',             // 抽屉里显示的中文名
    category: 'plan',              // 'base' | 'plan' | 'pad' | 'pc'
    desc: '最近使用的工作区入口',    // 一句中文说明（≤14 字）
    w: 7, h: 2,                    // 默认格数
    minW: 5, minH: 2,              // 最小格数
    maxW: 14, maxH: 3,             // 最大格数（可省略）
    render(ctx) {                  // 必须返回 HTML 字符串
      return `<div class="w w-card w-workspace">…</div>`
    },
    mount(root, ctx) {             // 可选：挂载后绑定交互/定时器，返回 cleanup
      const timer = setInterval(…, 1000)
      return () => clearInterval(timer)
    },
  },
  // …
]
```

- `render(ctx)` 接收的 `ctx = { uid, variant, theme, now }`：
  - `variant`：同一组件第几次被添加（0,1,2…），用来换演示数据（工作区卡片、链接卡片等）。
  - `theme`：`'dark' | 'light'`，一般不用判断，CSS 变量已处理；确实需要可读。
  - `now`：`Date` 对象。
- `mount(root, ctx)` 的 `root` 是 `render()` 生成内容的最外层容器（即 `.widget-inner`），
  可查询内部节点。返回的 cleanup 会在组件被删除/重渲染时调用。
- 渲染结果会放进应用提供的容器里，容器已经有**明确宽高**（按格数算好的像素值）和
  `container-type: size`，组件根节点必须 `width:100%; height:100%` 铺满（用 `.w` 类即可）。
- 同一个 widget 可能同时存在多个实例（如两个时钟），所有 id/查询都必须限定在 `root` 内，
  **禁止**使用全局 id、`document.querySelector` 找自己、`position:fixed`、`100vw/100vh`。

---

## 2. 设计 token（由 base.css 提供，组件里只准用变量）

两组主题在 `html[data-theme="dark"]` / `html[data-theme="light"]` 下切换。

| 变量 | dark | light | 用途 |
|---|---|---|---|
| `--bg-base` | `#131417` | `#f6f7fa` | 页面底 |
| `--bg-shell` | `#0e0f12` | `#eef0f5` | 侧栏/抽屉底 |
| `--bg-1` | `#191b20` | `#ffffff` | 卡片底 |
| `--bg-2` | `#1f2228` | `#f2f4f8` | 次级块 |
| `--bg-3` | `#262a31` | `#e8ebf1` | 更实的块/图表底 |
| `--surface` | `rgba(25,27,32,.82)` | `rgba(255,255,255,.90)` | 组件卡片背景 |
| `--surface-2` | `rgba(31,34,40,.92)` | `#f3f5f9` | 卡片内小方块 |
| `--surface-3` | `#262a31` | `#e9ecf2` | 进度条底等 |
| `--tx-1` | `#e9eaee` | `#181b21` | 主文字 |
| `--tx-2` | `#a8aeba` | `#5a6170` | 次文字 |
| `--tx-3` | `#767c88` | `#8a909c` | 弱文字/说明 |
| `--bd-1` | `#24272e` | `#e7e9ef` | 常规描边 |
| `--bd-2` | `#2f333b` | `#d9dce4` | 强调描边 |
| `--bd-3` | `#3d434e` | `#c9cdd7` | hover 描边 |
| `--brand` | `#4d6bfe` | `#4d6bfe` | 品牌蓝 |
| `--brand-2` | `#7aa2ff` | `#3557f0` | 亮品牌蓝 |
| `--brand-soft` | `rgba(77,107,254,.16)` | `rgba(77,107,254,.10)` | 品牌浅底 |
| `--green` | `#4ade80` | `#16a34a` | 成功 |
| `--amber` | `#e0a33a` | `#b7791f` | 警告 |
| `--red` | `#e0635b` | `#c2413a` | 错误/热度 |
| `--violet` | `#a78bfa` | `#7c5cf0` | 紫 |
| `--cyan` | `#22d3ee` | `#0891b2` | 青 |
| `--pink` | `#f472b6` | `#db2777` | 粉 |
| `--shadow-card` | `0 1px 0 rgba(255,255,255,.03) inset` | `0 1px 2px rgba(18,24,40,.05), 0 1px 0 rgba(255,255,255,.8) inset` | 卡片内阴影 |

字体变量：`--font`（正文）、`--mono`（等宽）。圆角：`--r-sm:8px`、`--r-md:12px`、
`--r-lg:16px`、`--r-xl:22px`。组件卡片圆角统一 `var(--r-lg)`。

**不要在组件 CSS 里写死颜色**（`#fff` 用于彩色渐变上的白字可以），也不要覆盖主题变量。
两种主题都必须好看：浅色下不要发灰、发脏；深色下不要一片死黑。

### 应用提供的公共类（可在 render 里直接用）

```html
<div class="w w-card">             <!-- 铺满 + 卡片底；卡片内自带 padding 时用 w-card-flush -->
  <div class="w-head">             <!-- 标题行：flex, align-center, gap 8px -->
    <span class="w-mark" style="background:…">A</span>   <!-- 28px 渐变图标块，白字 -->
    <span class="w-head-main">
      <span class="w-title">acme-web</span>              <!-- 12.5px 600 -->
      <span class="w-meta">2 个会话 · 2 小时前</span>      <!-- 10.5px 弱文字 -->
    </span>
    <span class="w-spacer"></span>
    <span class="w-chip">3</span>
  </div>
  <div class="w-body">…</div>
  <div class="w-foot">…</div>
</div>
```

- `.w`：`width:100%;height:100%;display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;overflow:hidden;border-radius:inherit`（base.css 里定义）。
- `.w-card`：`--surface` 底、`1px solid var(--bd-1)`、`--r-lg` 圆角、`box-shadow: var(--shadow-card)`、默认 `padding:12px 14px`。
- `.w-card-flush`：卡片底但 `padding:0`（日历、相册、终端自己控制内边距）。
- `.w-bare`：无背景、无边框、`overflow:visible`（Logo、标语用）。
- `.w-head / .w-title / .w-meta / .w-mark / .w-chip / .w-spacer / .w-body / .w-foot`：见 base.css。
- `.w-btn`、`.w-icon-btn`、`.w-pill`、`.w-progress`、`.w-divider` 等基础件也在 base.css，
  能用就用，保证和 Shell/输入框风格一致。**不确定有哪些类时先读 `styles/base.css` 再写。**

---

## 3. 交互约定

- 组件内部可交互元素（按钮、输入框、下拉、可点的列表项）必须加 `data-nodrag`
  属性，应用会据此区分「拖组件」和「点内容」。例如：
  `<button data-nodrag class="w-icon-btn" type="button">…</button>`。
  不加 `data-nodrag` 的元素会被当成拖动组件的抓手。
- 组件内部交互在 `mount(root, ctx)` 里用 `root.querySelector…` 绑定；注意
  `root` 是 `.widget-inner`，事件委托到 `root` 上最稳。
- 下拉菜单：用 `position:absolute` 相对组件根节点（`.w` 设 `position:relative`），
  `z-index:30`；**不要**用 `position:fixed`。菜单在卡片下沿时要向上弹。
- 所有演示数据写死即可；时钟/系统监控这类可以有轻量 `setInterval`，`mount` 返回 cleanup。
- 不需要自己处理选中、缩放、拖动、主题切换 —— 那是应用的事。
- 鼠标悬停可以有轻微反馈（边框变 `--bd-2`、背景微亮），不要做大幅位移/缩放。
- 组件在最小尺寸下不能溢出、不能文字压线；必要信息可隐藏（用 CSS `@container`
  查询或直接靠 `overflow:hidden` + `text-overflow:ellipsis`）。容器已设置
  `container-type:size`，可写 `@container (max-width: 200px) { … }`。
- 默认尺寸下必须完整、体面；最大尺寸下不要出现大片空洞（可让内容 flex 撑开）。

---

## 4. 组件清单与内容规格

> 尺寸单位 = 格。所有文案用简体中文；英文产品名保留原文。
> 默认尺寸下面给的宽高是「应用创建实例时用的 w/h」。

### 4.1 base-plan 作者（12 个）

**base 类（4 个）**

1. `dsh-logo` · DSH 标识 · `w4 h4`, `min 2×2`, `max 12×12`
   - `.w-bare` 铺满；**默认（variant 0）用 DSH 官方单色鲸鱼**（currentColor，取自 DSH
     favicon），`variant % 3 === 1` 时显示「onboarding 渐变方块 + 白鲸」，`=== 2` 时显示
     纯渐变方块（插件历史视觉）。鲸鱼路径来自 `assets/whale.svg` / 内联 path。
   - 用 `aspect-ratio:1` + `max-width/height:100%` 自适应；透明底，悬停轻微提亮。
   - 下面不要文字（真实 DSH hero Logo 就是纯图形）。

2. `tagline` · 标语 · `w10 h2`, `min 4×1`, `max 20×3`
   - `.w-bare`，居中「探索未至之境」，font-size `clamp(18px, 7cqw, 34px)`，600，
     `letter-spacing:.06em`，主文字色。可在下方加极淡的一行小字（可选，默认不要）。

3. `quick-actions` · 快捷操作 · `w8 h2`, `min 6×2`, `max 16×3`
   - 一行 3 个按钮（新建会话 / 打开工作区 / 自定义主页），胶囊或卡片按钮，
     图标 + 文字，`data-nodrag`，hover 提亮。空间不足时只显示图标 + tooltip。

4. `section-label` · 分组标题 · `w6 h1`, `min 3×1`, `max 16×2`
   - `.w-bare`，左侧一行小标题，12px/600，`--tx-3`，可带一个极小的计数 chip。
   - 按 `ctx.variant % 3` 轮换：「最近工作区 · 6」/「用量概览 · 3」/「常用站点 · 6」，
     保证同一布局里出现多次时不重复。垂直居中。

**plan 类（8 个）—— 与插件当前规划一致，数据参考 `docs/home.png`、`README.md`**

5. `workspace-card` · 工作区卡片 · `w7 h2` (min 5×2, max 14×3)
   - 图标块（首字母，渐变按 variant 轮换）+ 工作区名 + 次行「2 个会话 · 2 小时前」。
   - 演示数据（按 variant 轮换，至少 6 条）：acme-web 2 个会话·2 小时前；
     data-lab 14 个会话·4 小时前；notes-app 29 个会话·昨天；video-pipeline 78 个会话·3 天前；
     content-ops 46 个会话·6 天前；acme-web-plugin 16 个会话·9 天前。
   - 悬停时图标块变品牌蓝描边（类似插件里的效果）。

6. `link-card` · 常用站点 · `w7 h2` (min 5×2, max 14×3)
   - 站点图标（字母渐变方块）+ 站点名 + 域名。数据：GitHub/github.com、MDN/developer.mozilla.org、
     Stack Overflow/stackoverflow.com、Figma/figma.com、YouTube/youtube.com、Hacker News/news.ycombinator.com。

7. `usage-deepseek` · 用量 · DeepSeek · `w7 h2` (min 5×2, max 14×3)
   - 小圆点标「D」+ 「DeepSeek」小字；大字 `¥12.34` + 小字「余额」；
     底部细节「充值 ¥12.34 · 赠送 ¥0.00」。数字 `font-variant-numeric: tabular-nums`。

8. `usage-minimax` · 用量 · MiniMax · `w7 h2` (min 5×2, max 14×3)
   - 大字 `23%`（5 小时窗已用）+ 小字「5 小时」；底部「本周 9% · 2 小时 14 分后重置」。
   - 颜色正常时主文字色；可留 `data-tone="warn"` 样式接口（≥80% 转 `--amber`）。

9. `usage-cline` · 用量 · Cline Pass · `w7 h2` (min 5×2, max 14×3)
   - 大字 `35%` + 小字「本月已用」；底部「5 小时 22% · 本周 9%」。语义同 MiniMax。

10. `settings-entry` · 自定义主页入口 · `w6 h2` (min 5×2, max 12×3)
    - 齿轮图标 + 「自定义主页」+ 次行「配色 / 背景 / 组件」；右侧一个「打开」小按钮或 chevron。
    - 悬停齿轮转 30°，整体边框变 `--bd-3`。

11. `custom-note` · 自定义便签 · `w7 h3` (min 5×3, max 14×6)
    - 标题「今日速记」+ 右上角小 `+`；下面 3–4 行演示待办/短句；可点的复选框
      （`data-nodrag`，点击切换勾选样式，纯前端）。
    - 用 `--surface-2` 的小行块，勾选后文字变 `--tx-3` + 删除线。

12. `usage-opencode` · 用量 · OpenCode Go · `w7 h2` (min 5×2, max 14×3)
    - 大字 `62%` + 「5 小时」；底部「本周 41% · 本机 token 1.24M」。可选红色 tone 演示。

### 4.2 pad-pc 作者（14 个）

**pad 类（8 个）—— 平板/触屏语义的小组件，圆角更大、点击目标更大、信息更少**

13. `pad-clock` · 时钟 · `w5 h3` (min 4×3, max 10×6)
    - 中央大号时间（`HH:MM`，等宽数字，`clamp` 到容器宽），下面日期「11 月 7 日 · 周五」。
    - `mount` 里每秒更新（用 `ctx.now` 起步即可），cleanup 清 interval。
    - 背景可带一层极淡的品牌渐变光晕（`radial-gradient` 用 `--brand-soft`）。

14. `pad-weather` · 天气 · `w5 h3` (min 4×3, max 10×6)
    - 「上海」+ 大号 `18°` + 「多云」；底部「最高 21° / 最低 14°」，右侧可放 3 个
      小天气图标（☀︎ ☁︎ ☂︎ 用 SVG 或字符）。演示数据写死。

15. `pad-calendar` · 日历 · `w7 h5` (min 6×5, max 12×8)
    - 月份标题「2026 年 11 月」+ 星期行 + 6 行日期网格（周一起始），当天（7 日）
      用品牌蓝实心圆，周末数字略淡。日期用 `ctx.now` 计算，保证当月正确。
    - `.w-card-flush`，自己控制 padding。

16. `pad-todo` · 待办 · `w7 h4` (min 6×4, max 12×7)
    - 标题「待办」+ 右上「3/5」；4 条演示事项，复选框可点（`data-nodrag`），
      完成的删除线 + 弱化；底部一条 60% 进度条。

17. `pad-music` · 音乐 · `w7 h2` (min 6×2, max 12×4)
    - 左侧 32–40px 的专辑渐变方块；中间歌名「Night Drive」+ 歌手「Kiasmos」；
      右侧播放/暂停按钮 + 进度条。播放按钮点击切换图标（`data-nodrag`），纯演示。

18. `pad-battery` · 设备状态 · `w5 h2` (min 4×2, max 10×3)
    - 电池图形（82%，充电闪电）+ 「MacBook Pro」；右侧小字「剩余 4 小时 12 分」。
    - 电池填充用 `--green`，低电量可走 `--amber`（这里正常即可）。

19. `pad-photo` · 相册 · `w5 h5` (min 4×4, max 10×8)
    - `.w-card-flush`，2×2 或 3×2 的图片占位（只用 CSS 渐变：晚霞、森林、海岸、城市），
      右下角白色小字「回忆 · 2026」。不要外部图片。hover 单格微亮。

20. `pad-voice` · 语音备忘 · `w5 h2` (min 4×2, max 10×3)
    - 红色圆形录音按钮 + 波形竖条（20 根左右，CSS 高度错落）+ 时长「00:42」。

**pc 类（6 个）—— 桌面工作台语义，信息密度高、可用等宽字体**

21. `pc-system` · 系统监控 · `w7 h3` (min 6×3, max 12×5)
    - 两行指标：CPU 42%、内存 68%；各配一条进度条或迷你折线（内联 SVG/div）。
      底部小字「负载 1.24 · 温度 52°C」。数值 tabular-nums。

22. `pc-git` · Git 状态 · `w7 h3` (min 6×3, max 12×5)
    - 分支名「main」+ 状态「3 个文件待提交」；列出 3 个文件（M/A/D 徽标 + 文件名 +
      +12 −3 字数）；底部「提交」按钮（`data-nodrag`，点击给一个已提交的短暂反馈）。

23. `pc-pr` · GitHub PR · `w7 h3` (min 6×3, max 12×5)
    - 标题「待审 PR」+ 计数；2 条 PR（编号 #218/#214、标题、作者、状态点：
      绿=通过、黄=待审）；底部「查看全部 →」。

24. `pc-terminal` · 终端 · `w9 h3` (min 7×3, max 14×6)
    - 深色终端卡（深浅主题都用深色底 `#0d1016`，圆角同上），等宽字体；标题栏三个
      红黄绿圆点；2–3 行命令与输出（`$ pnpm test` / `✓ 128 passed` / 光标闪烁）。

25. `pc-rss` · 阅读列表 · `w7 h4` (min 6×4, max 12×7)
    - 标题「稍后阅读」+ 3 条文章（标题 + 来源/时长），左侧细色条；底部「8 篇未读」。

26. `pc-launcher` · 应用坞 · `w9 h2` (min 7×2, max 14×4)
    - 一行 6–8 个应用方块（Chrome / VS Code / Terminal / Figma / Slack / Notion），
      字母或极简 SVG 图标 + 渐变底；hover 上浮 2px；`data-nodrag`。

---

## 5. 质量门槛（交付前自查）

1. 两套主题、默认/最小/最大尺寸都不溢出、不重叠、不出现滚动条（终端内部除外）。
2. 所有可交互元素带 `data-nodrag`；点击不会触发画布拖动。
3. 控制台无报错；`mount` 都有 cleanup，重复删除/添加不残留 interval。
4. 只用 token 颜色；无 `!important`；无全局选择器（除 `@keyframes`）；无 `body`/`html` 规则。
5. CSS 只写自己文件，类名以 `.w-<id>` 开头或明确限定在 `.w-xxx` 下，避免撞名。
6. JS 语法为浏览器原生 ES2020，不用模块 import/export（用全局变量）。
7. 自测方法：Chrome 无头截图（需要 `--no-sandbox --disable-crash-reporter
   --user-data-dir=/tmp/xxx`），或直接让 Lead 集成后看整体截图。

交付时给 Lead 发一条消息：文件名、组件数量、未实现/存疑项、你已自测的内容。
