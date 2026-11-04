# dsh-my-newhome · DSH 自定义主页

给 DeepSeek Harness 桌面端换一整套首屏：配色、背景图、工作区卡片、常用入口、API 用量组件、自定义 Logo。
不改 DSH 本体，装/卸一个插件即可。MIT。

![首页示意](docs/home.png)

## 装上

桌面端 profile 由 Electron 独占管理，`dsh plugin --profile desktop add` 会被拒绝。两种装法：

- **插件管理器**（推荐）：设置 → 插件 → 选本地目录。
- **手动挂载**：在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 加 `"dsh-my-newhome": "link:<仓库路径>"`，
  `dsh.profile.bundles` 末尾加 `"dsh-my-newhome"`，再建软链
  `ln -sfn <仓库路径> ~/.dsh/profiles/desktop/node_modules/dsh-my-newhome`。

装完**重启 DeepSeek Harness**；卸载删掉这三处再重启。

## 有什么

| 功能 | 位置 / 说明 |
|---|---|
| 配色 / 背景图 / 自定义 Logo | 主题 token、固定背景层、hero + 侧栏品牌位 |
| 最近工作区（3×2） | 输入框上方，半衰期加权活跃度排序，可切最近使用 / 会话数 |
| 常用入口（3×2） | 同上，自动抓本机 Chrome 常访问站点 + 自定义 JSON 入口 |
| 自定义组件（最多 4 个） | 同上，标题行带 `↻`，点卡片本身也会刷新整行 |
| 设置面板 | 卡片下方 **⚙ 自定义主页**，所有选项都在里面 |

卡片只在首页（新会话）出现，打开历史对话自动隐藏；宽度跟随输入框实测宽度，换窗口也严丝合缝。

## 组件行（API 用量）

数据 60 秒缓存、默认 5 分钟轮询（1–60 可调）；取数失败显示 `—` 和原因，不影响其它卡片。

| 供应商 | 显示 | 来源 |
|---|---|---|
| DeepSeek | 余额 | 官方余额接口 |
| MiniMax | 本周剩余 %，本周不限显示 `∞` | coding-plan 配额接口 |
| Cline Pass | 最满窗口的已用 %（≥80% 转黄） | 订阅额度接口，5 小时 / 周 / 月三个窗口，悬停看全部 |
| 其它 | 本机 token 累计 | `session_projcache` 投影统计 |

key 从 `$DSH_HOME/.credentials.yaml` 读，永不下发浏览器。加供应商：`lib/index.js` 的 `PROVIDER_DEFS`
加一条，再在 `lib/client.js` 的 `WIDGET_PROVIDERS` 加下拉项即可。

## 数据

```
$DSH_HOME/dsh-my-newhome/
  config.json          # 配色、透明度、排序策略、入口与组件列表
  background.<ext>     # 背景原图
  logo.<ext>           # 自定义 Logo
```

图片走插件自己的路由 `/dsh-my-newhome/asset`（带 ETag，只监听回环 + 同源校验），不写进 `cordis.patch.yml`。

## 开发

```bash
node test/host.test.mjs    # 宿主半边 55 条断言
```

`preview.html` 是静态预览页。插件展示元数据按官方
[插件显示约定](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/cookbook/adding-a-package.md#plugin-display-metadata)
放在 `locale/en.json`、`locale/zh.json` 和 `icon.svg`，Plugins 页显示「Custom homepage / 自定义主页」。

## 边界

- Safari 历史受 macOS TCC 保护，需要「完全磁盘访问」；Chrome 可直接读。
- 侧栏 Logo 槽位需要 0.2.1+ 桌面运行时，旧版只替换首屏 Logo。
- DSH 内部槽位没有版本兼容承诺，接口缺失时静默降级。
