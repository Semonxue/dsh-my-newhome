/*!
 * 组件包：clock-lite v1.0.0
 * ---------------------------------------------------------------------------
 * 一个标准封装的主页组件 = 单个 .js 文件，顶层调用 DSH_WIDGET.define({...})。
 * 零权限：只读本地时间（不用 ctx.data，不发 request）。
 * 主题：只用 CSS 变量，跟随宿主发来的 theme 事件（token 在 iframe 内已注入）。
 * 单文件没有独立 CSS：样式写在 render() 返回的 HTML 里，靠 .w-<id> 前缀避免撞名。
 */

const MONTHS = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
  '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function readClock(date) {
  return {
    time: pad2(date.getHours()) + ':' + pad2(date.getMinutes()),
    date: MONTHS[date.getMonth()] + ' ' + date.getDate() + ' 日 · ' + WEEKDAYS[date.getDay()]
  };
}

const STYLE = `
.w-clock {
  padding: 14px 16px;
  border-radius: var(--r-lg);
  background:
    radial-gradient(120% 90% at 100% 0%, var(--brand-soft), transparent 58%),
    var(--surface);
  border: 1px solid var(--bd-1);
}
.w-clock-body {
  flex: 1;
  display: flex; flex-direction: column; justify-content: center;
  min-height: 0;
}
.w-clock-time {
  font-family: var(--mono);
  font-size: clamp(26px, 21cqw, 46px);
  font-weight: 600;
  letter-spacing: -.02em;
  line-height: 1.05;
  color: var(--tx-1);
  font-variant-numeric: tabular-nums;
}
.w-clock-date {
  margin-top: 5px;
  font-size: clamp(10px, 4.2cqw, 12px);
  color: var(--tx-2);
  letter-spacing: .01em;
}
.w-clock-foot {
  display: flex; align-items: center; gap: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--bd-1);
  font-size: 9.5px;
  color: var(--tx-3);
}
.w-clock-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 16%, transparent);
}
.w-clock-tag {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--tx-3);
  padding: 1px 6px;
  border: 1px dashed var(--bd-2);
  border-radius: 999px;
  white-space: nowrap;
}
`;

DSH_WIDGET.define({
  id: 'clock-lite',
  name: '时钟 · 轻量',
  version: '1.0.0',
  author: 'dsh-sandbox-demo',
  description: '零权限的本地时钟，跟随宿主主题。',
  permissions: [],
  grid: { w: 5, h: 3, minW: 4, minH: 3, maxW: 10, maxH: 6 },

  render(ctx) {
    const now = ctx.now instanceof Date ? ctx.now : new Date();
    const c = readClock(now);
    return [
      '<style>' + STYLE + '</style>',
      '<div class="w w-card w-clock" data-widget="clock-lite">',
      '  <div class="w-clock-body">',
      '    <div class="w-clock-time w-num" data-time>' + c.time + '</div>',
      '    <div class="w-clock-date" data-date>' + c.date + '</div>',
      '  </div>',
      '  <div class="w-clock-foot">',
      '    <span class="w-clock-dot"></span>本地时间',
      '    <span class="w-clock-tag">permissions: []</span>',
      '  </div>',
      '</div>'
    ].join('\n');
  },

  mount(root, ctx) {
    const timeEl = root.querySelector('[data-time]');
    const dateEl = root.querySelector('[data-date]');
    let alive = true;

    function tick() {
      if (!alive || !timeEl) return;
      const c = readClock(new Date());
      timeEl.textContent = c.time;
      dateEl.textContent = c.date;
    }

    tick();
    const timer = setInterval(tick, 1000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }
});
