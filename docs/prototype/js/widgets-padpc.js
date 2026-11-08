/* ============================================================================
 * widgets-padpc.js · 组件库 B：pad 类 8 个 + pc 类 6 个
 * 契约见 docs/prototype/CONTRACT.md 第 1/2/3/4.2 节。
 *
 * - 纯浏览器 ES2020，无模块、无外部资源、无网络请求。
 * - 导出 window.DSH_WIDGETS_PAD_PC（数组）。
 * - render(ctx) 返回 HTML 字符串；有交互的组件在 mount(root, ctx) 里绑定，
 *   返回 cleanup 负责解绑/清定时器。
 * - 组件内不使用全局 id / document.querySelector；所有查询都限定在 root 内。
 * ========================================================================== */
(function () {
  'use strict'

  /* ------------------------------------------------------------------ 工具 */

  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

  function pad2(n) {
    return n < 10 ? '0' + n : String(n)
  }

  function asDate(d) {
    return d instanceof Date && !isNaN(d.getTime()) ? d : new Date()
  }

  function dateLine(d) {
    return d.getMonth() + 1 + ' 月 ' + d.getDate() + ' 日 · 周' + WEEK_CN[d.getDay()]
  }

  function monthLine(year, month) {
    return year + ' 年 ' + (month + 1) + ' 月'
  }

  /* ------------------------------------------------ pad-calendar 日期网格 */

  function calendarCells(year, month, today) {
    var firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // 周一 = 第 0 列
    var days = new Date(year, month + 1, 0).getDate()
    var prevDays = new Date(year, month, 0).getDate()
    var cells = []
    for (var i = 0; i < 42; i += 1) {
      var n = i - firstDow + 1
      var isOut = n < 1 || n > days
      var day = n < 1 ? prevDays + n : n > days ? n - days : n
      var isToday =
        !isOut &&
        today.getFullYear() === year &&
        today.getMonth() === month &&
        today.getDate() === day
      var cls = 'cal-d'
      if (isOut) cls += ' is-out'
      if (i % 7 >= 5) cls += ' is-we'
      if (isToday) cls += ' is-today'
      cells.push('<span class="' + cls + '"><i>' + day + '</i></span>')
    }
    return cells.join('')
  }

  /* ------------------------------------------------------ pc-system 迷你折线 */

  var SPARK_CPU = [28, 36, 22, 45, 40, 52, 31, 58, 37, 46, 26, 49, 35, 42]
  var SPARK_MEM = [58, 64, 60, 68, 62, 72, 66, 70, 63, 74, 67, 69, 65, 68]

  function sparkGeom(vals) {
    var n = vals.length
    var pts = vals.map(function (v, i) {
      var x = (i / (n - 1)) * 100
      var y = 22.5 - (Math.max(4, Math.min(100, v)) / 100) * 20
      return x.toFixed(1) + ',' + y.toFixed(1)
    })
    return { line: pts.join(' '), area: '0,23 ' + pts.join(' ') + ' 100,23' }
  }

  /* ------------------------------------------------------------- 演示数据 */

  var SONGS = [
    { title: 'Night Drive', artist: 'Kiasmos', art: 'ND', pct: 38, elapsed: '1:24', total: '3:52' },
    { title: 'Says', artist: 'Nils Frahm', art: 'SA', pct: 52, elapsed: '2:10', total: '4:08' },
    { title: 'Awake', artist: 'Tycho', art: 'AW', pct: 24, elapsed: '0:58', total: '4:02' }
  ]

  var TODOS = [
    { text: '整理插件级联菜单', done: true },
    { text: '复核 pill 卡片 hover 态', done: true },
    { text: '补充主页空状态文案', done: true },
    { text: '检查深色主题对比度', done: false },
    { text: '写 v0.2 发布说明', done: false }
  ]

  var GIT_FILES = [
    { flag: 'M', dir: 'src/widgets/', name: 'padpc.js', add: 12, del: 3 },
    { flag: 'A', dir: 'styles/', name: 'padpc.css', add: 148, del: 0 },
    { flag: 'D', dir: 'docs/', name: 'old-plan.md', add: 0, del: 96 }
  ]

  var PRS = [
    { no: '#218', title: '修复侧栏折叠动画抖动', author: 'luyu', when: '3 小时前', state: 'ok' },
    { no: '#214', title: '组件库抽屉拖拽预览', author: 'chen', when: '1 天前', state: 'pending' }
  ]

  var READS = [
    { title: '为什么我们重新设计了组件库', meta: '少数派 · 8 分钟', tone: 'is-brand' },
    { title: 'CSS 容器查询实战笔记', meta: 'web.dev · 6 分钟', tone: 'is-amber' },
    { title: '拖拽交互的十个细节', meta: 'Smashing · 11 分钟', tone: 'is-violet' },
    { title: '设计 token 的命名学', meta: 'Figma Blog · 5 分钟', tone: 'is-cyan', extra: true },
    { title: '从原型到插件的距离', meta: 'DSH 博客 · 4 分钟', tone: 'is-pink', extra: true }
  ]

  var APPS = [
    { id: 'chrome', name: 'Chrome', short: 'C', bg: 'linear-gradient(145deg,var(--amber),var(--red))' },
    { id: 'vscode', name: 'VS Code', short: 'VS', bg: 'linear-gradient(145deg,var(--brand),var(--cyan))' },
    { id: 'terminal', name: 'Terminal', short: '&gt;_', bg: 'linear-gradient(145deg,var(--bd-3),var(--bg-3))' },
    { id: 'figma', name: 'Figma', short: 'F', bg: 'linear-gradient(145deg,var(--violet),var(--pink))' },
    { id: 'slack', name: 'Slack', short: 'S', bg: 'linear-gradient(145deg,var(--pink),var(--amber))' },
    { id: 'notion', name: 'Notion', short: 'N', bg: 'linear-gradient(145deg,var(--tx-2),var(--tx-3))' },
    { id: 'linear', name: 'Linear', short: 'L', bg: 'linear-gradient(145deg,var(--brand-2),var(--violet))' },
    { id: 'spotify', name: 'Spotify', short: '♫', bg: 'linear-gradient(145deg,var(--green),var(--cyan))' }
  ]

  var PHOTOS = [
    { cls: 'ph-sunset', label: '晚霞' },
    { cls: 'ph-forest', label: '森林' },
    { cls: 'ph-coast', label: '海岸' },
    { cls: 'ph-city', label: '城市' }
  ]

  var VOICE_BARS = [18, 34, 52, 70, 44, 88, 62, 40, 72, 56, 30, 66, 84, 48, 36, 60, 78, 42, 26, 50]

  /* ------------------------------------------------------------------ 图标 */

  var ICON_SUN =
    '<svg class="wx-ic wx-ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.1"></circle><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"></path></svg>'

  var ICON_CLOUD =
    '<svg class="wx-ic wx-ic-cloud" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.2h9.6a3.2 3.2 0 0 0 .3-6.4 4.7 4.7 0 0 0-9-1.2A3.5 3.5 0 0 0 7 18.2Z"></path></svg>'

  var ICON_RAIN =
    '<svg class="wx-ic wx-ic-rain" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2v1.3M4.7 12a7.3 7.3 0 0 1 14.6 0Z"></path><path d="M4.7 12h14.6"></path><path d="M12 12v5.2a2.1 2.1 0 0 0 4.2 0"></path></svg>'

  var ICON_BOLT =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.4 2.2 5.6 13.4h4.8l-1 8.4 7.9-11.4h-4.9l1-8.2Z"></path></svg>'

  var ICON_MIC =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.8" width="6" height="11.2" rx="3"></rect><path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0"></path><path d="M12 17.8v3.4"></path></svg>'

  var ICON_BRANCH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="5" r="2"></circle><circle cx="7" cy="19" r="2"></circle><circle cx="17" cy="7" r="2"></circle><path d="M7 7v10"></path><path d="M17 9v1a4 4 0 0 1-4 4H7"></path></svg>'

  var ICON_PLAY =
    '<svg class="mu-i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 6.2v11.6L18.4 12 9 6.2Z"></path></svg>'

  var ICON_PAUSE =
    '<svg class="mu-i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="8.2" y="6.2" width="2.9" height="11.6" rx="1"></rect><rect x="12.9" y="6.2" width="2.9" height="11.6" rx="1"></rect></svg>'

  /* ------------------------------------------------------------ 组件数组 */

  window.DSH_WIDGETS_PAD_PC = [
    /* ============================================================ pad 类 */
    {
      id: 'pad-clock',
      name: '时钟',
      category: 'pad',
      desc: '大字号时间与日期',
      w: 5,
      h: 3,
      minW: 4,
      minH: 3,
      maxW: 10,
      maxH: 6,
      render: function (ctx) {
        var d = asDate(ctx && ctx.now)
        return (
          '<div class="w w-card w-pad-clock">' +
          '<div class="clk-time">' +
          '<span data-clk-h>' + pad2(d.getHours()) + '</span>' +
          '<span class="clk-colon">:</span>' +
          '<span data-clk-m>' + pad2(d.getMinutes()) + '</span>' +
          '</div>' +
          '<div class="clk-date" data-clk-date>' + dateLine(d) + '</div>' +
          '<div class="clk-zone">上海 · GMT+8</div>' +
          '</div>'
        )
      },
      mount: function (root, ctx) {
        var base = asDate(ctx && ctx.now)
        var start = Date.now()
        var hEl = root.querySelector('[data-clk-h]')
        var mEl = root.querySelector('[data-clk-m]')
        var dEl = root.querySelector('[data-clk-date]')
        var lastMin = -1
        var tick = function () {
          var d = new Date(base.getTime() + (Date.now() - start))
          if (!hEl || !mEl) return
          hEl.textContent = pad2(d.getHours())
          mEl.textContent = pad2(d.getMinutes())
          if (d.getMinutes() !== lastMin) {
            lastMin = d.getMinutes()
            if (dEl) dEl.textContent = dateLine(d)
          }
        }
        tick()
        var timer = setInterval(tick, 1000)
        return function () {
          clearInterval(timer)
        }
      }
    },

    {
      id: 'pad-weather',
      name: '天气',
      category: 'pad',
      desc: '今日天气与高低温',
      w: 5,
      h: 3,
      minW: 4,
      minH: 3,
      maxW: 10,
      maxH: 6,
      render: function () {
        return (
          '<div class="w w-card w-pad-weather">' +
          '<div class="wx-top"><span class="wx-place">上海</span></div>' +
          '<div class="wx-mid">' +
          '<span class="wx-temp">18<span class="wx-deg">°</span></span>' +
          '<span class="wx-desc">多云</span>' +
          '</div>' +
          '<div class="wx-foot">' +
          '<span class="wx-hilo"><span>最高 21°</span><span class="wx-sep">/</span><span class="wx-lo">最低 14°</span></span>' +
          '<span class="wx-icons">' + ICON_SUN + ICON_CLOUD + ICON_RAIN + '</span>' +
          '</div>' +
          '</div>'
        )
      }
    },

    {
      id: 'pad-calendar',
      name: '日历',
      category: 'pad',
      desc: '月历与今日高亮',
      w: 7,
      h: 5,
      minW: 6,
      minH: 5,
      maxW: 12,
      maxH: 8,
      render: function (ctx) {
        var d = asDate(ctx && ctx.now)
        var y = d.getFullYear()
        var m = d.getMonth()
        var week = ['一', '二', '三', '四', '五', '六', '日']
          .map(function (t) {
            return '<span>' + t + '</span>'
          })
          .join('')
        return (
          '<div class="w w-card w-card-flush w-pad-calendar">' +
          '<div class="cal-head">' +
          '<span class="cal-mon" data-cal-mon>' + monthLine(y, m) + '</span>' +
          '<span class="cal-nav">' +
          '<button class="cal-btn" type="button" data-nodrag data-cal-step="-1" aria-label="上个月">‹</button>' +
          '<button class="cal-btn" type="button" data-nodrag data-cal-step="1" aria-label="下个月">›</button>' +
          '</span>' +
          '</div>' +
          '<div class="cal-week">' + week + '</div>' +
          '<div class="cal-grid" data-cal-grid>' + calendarCells(y, m, d) + '</div>' +
          '</div>'
        )
      },
      mount: function (root, ctx) {
        var today = asDate(ctx && ctx.now)
        var y = today.getFullYear()
        var m = today.getMonth()
        var monEl = root.querySelector('[data-cal-mon]')
        var gridEl = root.querySelector('[data-cal-grid]')
        var onTap = function (e) {
          var btn = e.target.closest ? e.target.closest('[data-cal-step]') : null
          if (!btn) return
          var step = Number(btn.getAttribute('data-cal-step')) || 0
          var next = new Date(y, m + step, 1)
          y = next.getFullYear()
          m = next.getMonth()
          if (monEl) monEl.textContent = monthLine(y, m)
          if (gridEl) gridEl.innerHTML = calendarCells(y, m, today)
          e.preventDefault()
        }
        root.addEventListener('click', onTap)
        return function () {
          root.removeEventListener('click', onTap)
        }
      }
    },

    {
      id: 'pad-todo',
      name: '待办',
      category: 'pad',
      desc: '触控待办清单',
      w: 7,
      h: 4,
      minW: 6,
      minH: 4,
      maxW: 12,
      maxH: 7,
      render: function () {
        var done = TODOS.filter(function (t) {
          return t.done
        }).length
        var pct = Math.round((done / TODOS.length) * 100)
        var rows = TODOS.map(function (t, i) {
          return (
            '<button class="td-row' + (t.done ? ' is-done' : '') + '" type="button" data-nodrag>' +
            '<span class="td-box" aria-hidden="true">✓</span>' +
            '<span class="td-txt">' + t.text + '</span>' +
            '</button>'
          )
        }).join('')
        return (
          '<div class="w w-card w-pad-todo">' +
          '<div class="td-head"><span class="td-title">待办</span><span class="td-count" data-td-count>' +
          done + '/' + TODOS.length + '</span></div>' +
          '<div class="td-list">' + rows + '</div>' +
          '<div class="td-foot">' +
          '<span class="td-bar"><i style="width:' + pct + '%" data-td-bar></i></span>' +
          '<span class="td-pct" data-td-pct>' + pct + '%</span>' +
          '</div>' +
          '</div>'
        )
      },
      mount: function (root) {
        var rows = Array.prototype.slice.call(root.querySelectorAll('.td-row'))
        var countEl = root.querySelector('[data-td-count]')
        var barEl = root.querySelector('[data-td-bar]')
        var pctEl = root.querySelector('[data-td-pct]')
        var onTap = function (e) {
          var row = e.target.closest ? e.target.closest('.td-row') : null
          if (!row) return
          row.classList.toggle('is-done')
          var done = rows.filter(function (r) {
            return r.classList.contains('is-done')
          }).length
          var total = rows.length
          var pct = Math.round((done / total) * 100)
          if (countEl) countEl.textContent = done + '/' + total
          if (barEl) barEl.style.width = pct + '%'
          if (pctEl) pctEl.textContent = pct + '%'
        }
        root.addEventListener('click', onTap)
        return function () {
          root.removeEventListener('click', onTap)
        }
      }
    },

    {
      id: 'pad-music',
      name: '音乐',
      category: 'pad',
      desc: '正在播放与进度',
      w: 7,
      h: 2,
      minW: 6,
      minH: 2,
      maxW: 12,
      maxH: 4,
      render: function (ctx) {
        var song = SONGS[Math.abs(ctx && ctx.variant ? ctx.variant : 0) % SONGS.length]
        return (
          '<div class="w w-card w-pad-music">' +
          '<span class="mu-art" aria-hidden="true">' + song.art + '</span>' +
          '<div class="mu-main">' +
          '<span class="mu-title">' + song.title + '</span>' +
          '<span class="mu-artist">' + song.artist + '</span>' +
          '<span class="mu-prog">' +
          '<span class="mu-track"><i style="width:' + song.pct + '%"></i></span>' +
          '<span class="mu-time">' + song.elapsed + ' / ' + song.total + '</span>' +
          '</span>' +
          '</div>' +
          '<button class="mu-play" type="button" data-nodrag data-mu-play aria-label="播放" title="播放">' +
          ICON_PLAY + ICON_PAUSE +
          '</button>' +
          '</div>'
        )
      },
      mount: function (root) {
        var btn = root.querySelector('[data-mu-play]')
        if (!btn) return
        var card = btn.closest('.w-pad-music')
        var onTap = function () {
          if (!card) return
          var playing = card.classList.toggle('is-playing')
          btn.setAttribute('aria-label', playing ? '暂停' : '播放')
          btn.setAttribute('title', playing ? '暂停' : '播放')
        }
        btn.addEventListener('click', onTap)
        return function () {
          btn.removeEventListener('click', onTap)
        }
      }
    },

    {
      id: 'pad-battery',
      name: '设备状态',
      category: 'pad',
      desc: '设备电量与续航',
      w: 5,
      h: 2,
      minW: 4,
      minH: 2,
      maxW: 10,
      maxH: 3,
      render: function () {
        return (
          '<div class="w w-card w-pad-battery">' +
          '<div class="bt-left">' +
          '<div class="bt-row">' +
          '<span class="bt-shape" role="img" aria-label="电量 82%，充电中">' +
          '<i class="bt-fill" style="width:82%"></i>' +
          '<span class="bt-bolt">' + ICON_BOLT + '</span>' +
          '</span>' +
          '<span class="bt-pct">82%</span>' +
          '</div>' +
          '<span class="bt-name">MacBook Pro</span>' +
          '</div>' +
          '<div class="bt-eta"><span class="bt-eta-l">剩余</span><span class="bt-eta-v">4 小时 12 分</span></div>' +
          '</div>'
        )
      }
    },

    {
      id: 'pad-photo',
      name: '相册',
      category: 'pad',
      desc: '回忆相册网格',
      w: 5,
      h: 5,
      minW: 4,
      minH: 4,
      maxW: 10,
      maxH: 8,
      render: function () {
        var tiles = PHOTOS.map(function (p) {
          return '<div class="ph-t ' + p.cls + '" role="img" aria-label="' + p.label + '"></div>'
        }).join('')
        return (
          '<div class="w w-card w-card-flush w-pad-photo">' +
          '<div class="ph-grid">' + tiles + '</div>' +
          '<span class="ph-scrim" aria-hidden="true"></span>' +
          '<span class="ph-cap">回忆 · 2026</span>' +
          '</div>'
        )
      }
    },

    {
      id: 'pad-voice',
      name: '语音备忘',
      category: 'pad',
      desc: '语音备忘与波形',
      w: 5,
      h: 2,
      minW: 4,
      minH: 2,
      maxW: 10,
      maxH: 3,
      render: function () {
        var bars = VOICE_BARS.map(function (h) {
          return '<i style="height:' + h + '%"></i>'
        }).join('')
        return (
          '<div class="w w-card w-pad-voice">' +
          '<button class="vo-btn" type="button" data-nodrag data-vo-btn aria-label="开始录音" title="开始录音">' +
          ICON_MIC +
          '</button>' +
          '<span class="vo-wave" aria-hidden="true">' + bars + '</span>' +
          '<span class="vo-time" data-vo-time>00:42</span>' +
          '</div>'
        )
      },
      mount: function (root) {
        var btn = root.querySelector('[data-vo-btn]')
        var card = btn ? btn.closest('.w-pad-voice') : null
        var timeEl = root.querySelector('[data-vo-time]')
        var sec = 42
        var timer = null
        if (!btn || !card) return
        var fmt = function (s) {
          return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60)
        }
        var stop = function () {
          if (timer) {
            clearInterval(timer)
            timer = null
          }
        }
        var onTap = function () {
          var active = card.classList.toggle('is-rec')
          btn.setAttribute('aria-label', active ? '停止录音' : '开始录音')
          btn.setAttribute('title', active ? '停止录音' : '开始录音')
          if (active) {
            timer = setInterval(function () {
              sec += 1
              if (timeEl) timeEl.textContent = fmt(sec)
            }, 1000)
          } else {
            stop()
          }
        }
        btn.addEventListener('click', onTap)
        return function () {
          btn.removeEventListener('click', onTap)
          stop()
        }
      }
    },

    /* ============================================================= pc 类 */
    {
      id: 'pc-system',
      name: '系统监控',
      category: 'pc',
      desc: 'CPU 与内存监控',
      w: 7,
      h: 3,
      minW: 6,
      minH: 3,
      maxW: 12,
      maxH: 5,
      render: function () {
        var cpu = sparkGeom(SPARK_CPU)
        var mem = sparkGeom(SPARK_MEM)
        return (
          '<div class="w w-card w-pc-system">' +
          '<div class="sy-head"><span class="sy-title">系统监控</span><span class="sy-live"><i></i>实时</span></div>' +
          '<div class="sy-list">' +
          '<div class="sy-item" data-metric="cpu">' +
          '<div class="sy-top"><span class="sy-name">CPU</span><span class="sy-val"><b data-sy-val>42</b><em>%</em></span></div>' +
          '<div class="sy-spark"><svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">' +
          '<polygon data-sy-area points="' + cpu.area + '" style="fill:var(--brand);opacity:.15"></polygon>' +
          '<polyline data-sy-line points="' + cpu.line + '" style="fill:none;stroke:var(--brand);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke"></polyline>' +
          '</svg></div>' +
          '</div>' +
          '<div class="sy-item" data-metric="mem">' +
          '<div class="sy-top"><span class="sy-name">内存</span><span class="sy-val"><b data-sy-val>68</b><em>%</em></span></div>' +
          '<div class="sy-spark"><svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">' +
          '<polygon data-sy-area points="' + mem.area + '" style="fill:var(--violet);opacity:.15"></polygon>' +
          '<polyline data-sy-line points="' + mem.line + '" style="fill:none;stroke:var(--violet);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke"></polyline>' +
          '</svg></div>' +
          '</div>' +
          '</div>' +
          '<div class="sy-foot">负载 1.24 · 温度 52°C</div>' +
          '</div>'
        )
      },
      mount: function (root) {
        var items = [
          { sel: '[data-metric="cpu"]', vals: SPARK_CPU.slice(), target: 42 },
          { sel: '[data-metric="mem"]', vals: SPARK_MEM.slice(), target: 68 }
        ]
        var timer = setInterval(function () {
          items.forEach(function (it) {
            var node = root.querySelector(it.sel)
            if (!node) return
            var last = it.vals[it.vals.length - 1]
            var next = Math.round(
              Math.max(12, Math.min(94, last + (Math.random() * 16 - 8) + (it.target - last) * 0.3))
            )
            it.vals.push(next)
            it.vals.shift()
            var valEl = node.querySelector('[data-sy-val]')
            if (valEl) valEl.textContent = String(next)
            var geom = sparkGeom(it.vals)
            var lineEl = node.querySelector('[data-sy-line]')
            var areaEl = node.querySelector('[data-sy-area]')
            if (lineEl) lineEl.setAttribute('points', geom.line)
            if (areaEl) areaEl.setAttribute('points', geom.area)
          })
        }, 2000)
        return function () {
          clearInterval(timer)
        }
      }
    },

    {
      id: 'pc-git',
      name: 'Git 状态',
      category: 'pc',
      desc: '工作区改动与提交',
      w: 7,
      h: 3,
      minW: 6,
      minH: 3,
      maxW: 12,
      maxH: 5,
      render: function () {
        var rows = GIT_FILES.map(function (f) {
          return (
            '<div class="gt-row">' +
            '<span class="gt-b is-' + f.flag.toLowerCase() + '">' + f.flag + '</span>' +
            '<span class="gt-n"><span class="gt-dir">' + f.dir + '</span>' + f.name + '</span>' +
            '<span class="gt-diff"><b>+' + f.add + '</b><i>−' + f.del + '</i></span>' +
            '</div>'
          )
        }).join('')
        return (
          '<div class="w w-card w-pc-git">' +
          '<div class="gt-head">' +
          '<span class="gt-branch">' + ICON_BRANCH + 'main</span>' +
          '<span class="gt-dirty" data-gt-dirty>3 个文件待提交</span>' +
          '</div>' +
          '<div class="gt-files">' + rows + '</div>' +
          '<button class="gt-btn" type="button" data-nodrag data-gt-commit>提交</button>' +
          '</div>'
        )
      },
      mount: function (root) {
        var btn = root.querySelector('[data-gt-commit]')
        var dirty = root.querySelector('[data-gt-dirty]')
        if (!btn) return
        var timer = null
        var onTap = function () {
          if (btn.disabled) return
          var prev = dirty ? dirty.textContent : ''
          btn.disabled = true
          btn.classList.add('is-ok')
          btn.textContent = '已提交 ✓'
          if (dirty) dirty.textContent = '工作区干净'
          timer = setTimeout(function () {
            btn.disabled = false
            btn.classList.remove('is-ok')
            btn.textContent = '提交'
            if (dirty) dirty.textContent = prev
          }, 1600)
        }
        btn.addEventListener('click', onTap)
        return function () {
          btn.removeEventListener('click', onTap)
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
        }
      }
    },

    {
      id: 'pc-pr',
      name: 'GitHub PR',
      category: 'pc',
      desc: '待审 PR 列表',
      w: 7,
      h: 3,
      minW: 6,
      minH: 3,
      maxW: 12,
      maxH: 5,
      render: function () {
        var rows = PRS.map(function (p) {
          var ok = p.state === 'ok'
          return (
            '<div class="pr-item">' +
            '<span class="pr-dot ' + (ok ? 'is-ok' : 'is-pending') + '" aria-hidden="true"></span>' +
            '<span class="pr-main">' +
            '<span class="pr-name"><b>' + p.no + '</b>' + p.title + '</span>' +
            '<span class="pr-sub">' + p.author + ' · ' + p.when + '</span>' +
            '</span>' +
            '<span class="pr-state ' + (ok ? 'is-ok' : 'is-pending') + '">' + (ok ? '通过' : '待审') + '</span>' +
            '</div>'
          )
        }).join('')
        return (
          '<div class="w w-card w-pc-pr">' +
          '<div class="pr-head"><span class="pr-title">待审 PR</span><span class="pr-chip">2</span></div>' +
          '<div class="pr-list">' + rows + '</div>' +
          '<button class="pr-more" type="button" data-nodrag data-pr-more>查看全部 →</button>' +
          '</div>'
        )
      },
      mount: function (root) {
        var btn = root.querySelector('[data-pr-more]')
        if (!btn) return
        var timer = null
        var label = btn.textContent
        var onTap = function () {
          if (btn.dataset.busy === '1') return
          btn.dataset.busy = '1'
          btn.textContent = '3 条更多 PR 待查看'
          timer = setTimeout(function () {
            btn.textContent = label
            delete btn.dataset.busy
            timer = null
          }, 1500)
        }
        btn.addEventListener('click', onTap)
        return function () {
          btn.removeEventListener('click', onTap)
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
        }
      }
    },

    {
      id: 'pc-terminal',
      name: '终端',
      category: 'pc',
      desc: '测试命令与输出',
      w: 9,
      h: 3,
      minW: 7,
      minH: 3,
      maxW: 14,
      maxH: 6,
      render: function () {
        return (
          '<div class="w w-card w-pc-terminal">' +
          '<div class="tm-bar">' +
          '<span class="tm-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="tm-title">dsh — zsh</span>' +
          '</div>' +
          '<div class="tm-body">' +
          '<div class="tm-line"><span class="tm-prompt">$</span>pnpm test</div>' +
          '<div class="tm-line tm-ok">✓ 128 passed · 4.2s</div>' +
          '<div class="tm-line tm-extra">Test Files  12 passed (12)</div>' +
          '<div class="tm-line tm-extra tm-extra-2">Duration    4.21s</div>' +
          '<div class="tm-line"><span class="tm-prompt">$</span><span class="tm-caret" aria-hidden="true"></span></div>' +
          '</div>' +
          '</div>'
        )
      }
    },

    {
      id: 'pc-rss',
      name: '阅读列表',
      category: 'pc',
      desc: '稍后阅读列表',
      w: 7,
      h: 4,
      minW: 6,
      minH: 4,
      maxW: 12,
      maxH: 7,
      render: function () {
        var rows = READS.map(function (r) {
          return (
            '<button class="rs-item' + (r.extra ? ' is-extra' : '') + '" type="button" data-nodrag>' +
            '<span class="rs-bar ' + r.tone + '" aria-hidden="true"></span>' +
            '<span class="rs-main">' +
            '<span class="rs-name">' + r.title + '</span>' +
            '<span class="rs-meta">' + r.meta + '</span>' +
            '</span>' +
            '</button>'
          )
        }).join('')
        return (
          '<div class="w w-card w-pc-rss">' +
          '<div class="rs-head"><span class="rs-title">稍后阅读</span></div>' +
          '<div class="rs-list">' + rows + '</div>' +
          '<div class="rs-foot">8 篇未读</div>' +
          '</div>'
        )
      }
    },

    {
      id: 'pc-launcher',
      name: '应用坞',
      category: 'pc',
      desc: '常用应用坞',
      w: 9,
      h: 2,
      minW: 7,
      minH: 2,
      maxW: 14,
      maxH: 4,
      render: function () {
        var apps = APPS.map(function (a) {
          return (
            '<button class="la-app" type="button" data-nodrag data-app="' + a.id + '" title="' + a.name + '" aria-label="' + a.name + '">' +
            '<span class="la-ic" style="background:' + a.bg + '"><span class="la-glyph' + (a.short.length > 1 ? ' is-2' : '') + '">' + a.short + '</span></span>' +
            '<span class="la-name">' + a.name + '</span>' +
            '</button>'
          )
        }).join('')
        return '<div class="w w-card w-pc-launcher">' + apps + '</div>'
      },
      mount: function (root) {
        var apps = Array.prototype.slice.call(root.querySelectorAll('.la-app'))
        var onTap = function (e) {
          var app = e.target.closest ? e.target.closest('.la-app') : null
          if (!app) return
          apps.forEach(function (a) {
            if (a !== app) a.classList.remove('is-active')
          })
          app.classList.toggle('is-active')
        }
        root.addEventListener('click', onTap)
        return function () {
          root.removeEventListener('click', onTap)
        }
      }
    }
  ]
})()
