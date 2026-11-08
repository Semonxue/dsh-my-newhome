# DSH 左右栏开合的真实布局行为（原型对齐依据）

结论先行：**DSH 的左右栏是同一个 CSS Grid 的列轨道；开合只改变列宽，不改变任何垂直尺寸。**
新会话首页的 Logo / 标语 / 输入框高度、区块间距、卡片高度都是固定值，只有宽度会随中栏
宽度变化。

## 1. 三列 frame

`dsh-client-ui-layout/lib/client.js`（DSH Desktop 0.2.2-rc.1）：

```js
// AppFrame: 行轨道固定，只有列轨道变化
style: {
  gridTemplateColumns: `${cols.sidebar}px minmax(${cols.rightbar === 0 ? 0 : 400}px, 1fr) minmax(0px, ${rightbarMax}px)`
}
// CSS
// .frame { grid-template-rows: minmax(0,1fr) auto; height:100%; display:grid }
// .sidebarCol { grid-area:1/1 }
// .centerCol  { grid-area:1/2; height:100% 的 flex column }
// .rightbarCol{ grid-area:1/3 }
```

- 左栏默认 **280px**，拖拽范围 264–420；视口 <1024 自动折叠；<768 变覆盖式抽屉。
- 右栏默认 **45% frame 宽**，clamp(300, 70%)；开启 track 时给中栏留出宽度，中栏最小 400；
  若不占 track，右栏面板仍挂在第三列右边缘、覆盖中栏，**两种模式都不参与垂直布局**。
- 开合动画只作用于 `grid-template-columns`（`transition: grid-template-columns …`），
  从不触发行轨道。所以 page height / hero 的位置不变。

## 2. 首页中栏：只有宽度响应式

`dsh-client-ui-conversation/lib/client.js`（编译后的 CSS 类名做了可读化处理，数值/属性保持原样）：

```css
.chatBody {
  --dsh-chat-content-width: clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px);
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
}
.composerHero { width: min(calc(var(--dsh-composer-card-max-width) + 2 * 16px), 100%); padding-bottom: 32px; }
.scrollBody[data-phase="hero"] { justify-content: center; }
.heroHeadline { font-size: 26px; font-weight: 500; line-height: 32px; }
```

- 输入框宽度 = `clamp(680, 中栏宽 × 0.64, 920) + 32`，**只依赖中栏宽度**；卡片高度、
  文本区 min-height、底部控制行高度都是固定值。
- hero 用 `justify-content:center` 在剩余高度里垂直居中；左右栏开合不改变这个高度。
- Logo 34px、标语 26/32、工作区行 28px、卡片 min-height 60px 等均为固定值。

## 3. 原型采用的规则

- **列宽响应**：`cellW = (canvasWidth − 6 × 23) / 24`，**只随左侧 DSH 侧栏 / 窗口宽度变化**。
- **行高固定**：`rowH = 30px`，`stepY = 36px`；画布高度只由行数决定，与宽度无关。
- **右侧组件抽屉是浮层**：编辑器 chrome，不是 DSH 主页的一部分；`position:absolute`，
  不参与 flex/grid 布局，不推挤画布。抽屉打开时画布右缘追加一段可滚动余量，用户左右滚动
  即可查看被浮层盖住的区域；关闭后滚动位置归零。这样右侧 tab 完全不会触发画布响应式。
  DSH 右栏本身有 track（推挤）与 overlay 两种存在方式，这里按本产品诉求固定选用 overlay
  语义，不模拟 track 推挤。
- 画布最大宽 1080px；当窗口已经宽到内容达到上限时，继续关左栏不会再把内容拉宽——
  这与 DSH 的 `920 + 32` 内容上限一致。

## 4. 对原型的影响

之前原型把「格」当成正方形，行高 = 列宽，导致关侧栏时整页被等比放大、垂直高度变化；
右侧抽屉也曾和左栏一起参与宽度计算。现在改成「列宽可变、行高固定 + 右侧浮层」后：

- 关左栏：中栏变宽，输入框/卡片变宽，垂直位置与高度完全不动。
- 开关右抽屉：画布宽度、列宽、组件位置/尺寸全部逐像素不变；只出现可横向滚动的余量。
- 拖拽、缩放、碰撞仍然按格计算；只是列方向上按 `stepX`、行方向上按 `stepY` 吸附。

## 5. 改完后的原型的实测

1280px 宽、`plan` 预设（`canvasHeight` 均由行数决定）：

| 状态 | 列宽 cell | 画布宽 | 画布高 | composer top / height |
|---|---|---|---|---|
| 侧栏开 + 抽屉开 | 36.58px | 1016px | 1038px | 324px / 102px |
| 侧栏开 + 抽屉关 | 36.58px | 1016px | 1038px | 324px / 102px |
| 侧栏关 + 抽屉关 | 39.25px | 1080px | 1038px | 324px / 102px |
| 侧栏关 + 抽屉开 | 39.25px | 1080px | 1038px | 324px / 102px |

即：**右侧抽屉开合对画布零影响；只有左侧栏开合/窗口宽度会改变列宽；所有垂直数值逐像素
不变**。抽屉打开时 `#canvas-scroll` 的 `scrollWidth` 大于 `clientWidth`，横向滚动可查看
被盖住的内容。`docs/prototype/js/app.js` 中的 `ROW_H = 30`、`stepX / stepY`，以及
`#canvas-pan-tail` 就是这条规则的落点。

证据文件都在 `app.asar` 的 `@deepseek-ai/dsh-client-ui-layout` 与
`dsh-client-ui-conversation` 包内；行号以上文引用为准（DSH 0.2.2-rc.1）。
