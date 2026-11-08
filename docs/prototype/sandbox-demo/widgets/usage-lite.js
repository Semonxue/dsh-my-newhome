/*!
 * 组件包：usage-lite v1.0.0
 * ---------------------------------------------------------------------------
 * 声明权限 usage.read，宿主只回传已脱敏的模拟数据（没有 key、没有账号、没有路径）。
 * 首次请求时宿主会弹「允许 / 拒绝」确认条；拒绝后 request() 的 Promise 会以
 * code=E_PERM_DENIED 拒绝，组件必须自己兜住（这里显示"未授权"）。
 *
 * 数据形态（宿主契约）：
 *   [{ provider, kind: 'balance'|'quota', amount?, currency?,
 *      percent5h?, percentWeek?, percentMonth?, resetAt?, tone? }]
 */

const STYLE = `
.w-usage { padding: 12px 14px; }
.w-usage-main {
  flex: 1;
  display: flex; align-items: baseline; gap: 4px;
  min-height: 0;
  padding-top: 8px;
}
.w-usage-big {
  font-family: var(--mono);
  font-size: clamp(30px, 19cqw, 52px);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -.03em;
  color: var(--tx-1);
  font-variant-numeric: tabular-nums;
}
.w-usage-unit { font-size: 15px; color: var(--tx-3); font-weight: 500; }
.w-usage-label {
  margin-left: auto;
  align-self: flex-end;
  font-size: 9.5px;
  color: var(--tx-3);
  white-space: nowrap;
  padding-bottom: 3px;
}
.w-usage-bar {
  height: 4px; border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
  margin-top: 8px;
}
.w-usage-bar > i {
  display: block; height: 100%; width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), var(--brand-2));
  transition: width .3s var(--ease);
}
.w-usage-bar[data-tone="warn"] > i { background: linear-gradient(90deg, var(--amber), var(--red)); }
.w-usage-foot {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px;
  font-size: 9.5px;
  color: var(--tx-3);
  min-width: 0;
}
.w-usage-foot[data-tone="err"] { color: var(--red); }
.w-usage-dot {
  flex: none;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--brand-2);
}
.w-usage-foot[data-tone="err"] .w-usage-dot { background: var(--red); }
.w-usage-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w-usage-foot .w-btn { height: 20px; padding: 0 7px; font-size: 9.5px; margin-left: auto; }
`;

function pickQuota(data) {
  if (!Array.isArray(data)) return null;
  return data.filter(function (x) { return x && x.kind === 'quota'; })[0] || null;
}

function resetText(resetAt) {
  const t = Date.parse(resetAt);
  if (!t) return '';
  const mins = Math.max(0, Math.round((t - Date.now()) / 60000));
  if (mins >= 60) return Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分后重置';
  return mins + ' 分后重置';
}

DSH_WIDGET.define({
  id: 'usage-lite',
  name: '用量 · 轻量',
  version: '1.0.0',
  author: 'dsh-sandbox-demo',
  description: '申请 usage.read，画一个大字百分比 + 周/月明细。',
  permissions: ['usage.read'],
  grid: { w: 5, h: 3, minW: 4, minH: 3, maxW: 10, maxH: 6 },

  render(ctx) {
    const data = ctx.data && ctx.data['usage.read'];
    const q = pickQuota(data);
    const pct = q ? q.percent5h : null;
    const has = pct != null;
    const foot = has
      ? '本周 ' + q.percentWeek + '% · 本月 ' + q.percentMonth + '% · ' + resetText(q.resetAt)
      : '等待宿主授权 usage.read…';
    return [
      '<style>' + STYLE + '</style>',
      '<div class="w w-card w-usage" data-widget="usage-lite">',
      '  <div class="w-head">',
      '    <span class="w-mark" style="background:linear-gradient(135deg,var(--brand),var(--violet))">M</span>',
      '    <span class="w-head-main">',
      '      <span class="w-title" data-title>' + (q ? q.provider : '用量') + '</span>',
      '      <span class="w-meta">5 小时窗口 · 已脱敏</span>',
      '    </span>',
      '    <button class="w-icon-btn" type="button" data-refresh title="重新请求授权数据">⟳</button>',
      '  </div>',
      '  <div class="w-usage-main">',
      '    <span class="w-usage-big w-num" data-pct>' + (has ? String(pct) : '—') + '</span>',
      '    <span class="w-usage-unit">%</span>',
      '    <span class="w-usage-label">已用</span>',
      '  </div>',
      '  <div class="w-usage-bar" data-bar><i style="width:' + (has ? pct : 0) + '%"></i></div>',
      '  <div class="w-usage-foot" data-foot data-tone="' + (has ? '' : 'err') + '">',
      '    <span class="w-usage-dot"></span>',
      '    <span class="w-usage-note" data-note>' + foot + '</span>',
      '  </div>',
      '</div>'
    ].join('\n');
  },

  mount(root, ctx) {
    const els = {
      title: root.querySelector('[data-title]'),
      pct: root.querySelector('[data-pct]'),
      bar: root.querySelector('[data-bar]'),
      foot: root.querySelector('[data-foot]'),
      note: root.querySelector('[data-note]'),
      refresh: root.querySelector('[data-refresh]')
    };
    let alive = true;

    function paint(list) {
      if (!alive) return;
      const q = pickQuota(list);
      if (!q || q.percent5h == null) {
        els.pct.textContent = '—';
        els.bar.firstElementChild.style.width = '0%';
        els.note.textContent = '返回数据为空';
        els.foot.dataset.tone = 'err';
        return;
      }
      els.title.textContent = q.provider || '用量';
      els.pct.textContent = String(q.percent5h);
      els.bar.firstElementChild.style.width = Math.min(100, q.percent5h) + '%';
      els.bar.dataset.tone = q.percent5h >= 80 ? 'warn' : '';
      els.note.textContent = '本周 ' + q.percentWeek + '% · 本月 ' + q.percentMonth + '% · ' + resetText(q.resetAt);
      els.foot.dataset.tone = '';
      els.refresh.title = '数据来自宿主已脱敏的模拟接口';
      DSH_WIDGET.notify('info', '用量已渲染：5h ' + q.percent5h + '% · 周 ' + q.percentWeek + '% · 月 ' + q.percentMonth + '%');
    }

    function waiting(text) {
      if (!alive) return;
      els.pct.textContent = '—';
      els.bar.firstElementChild.style.width = '0%';
      els.note.textContent = text;
      els.foot.dataset.tone = 'err';
    }

    const initial = ctx.data && ctx.data['usage.read'];
    if (initial) paint(initial);
    else waiting('等待宿主授权 usage.read…');

    const offData = ctx.on('data', function (payload) {
      if (payload && payload.resource === 'usage.read') paint(payload.data);
    });

    function onRefresh() {
      DSH_WIDGET.request('usage.read').then(paint).catch(function (err) {
        waiting('请求被拒绝：' + (err.code || err.name || 'ERROR'));
      });
    }
    els.refresh.addEventListener('click', onRefresh);

    return () => {
      alive = false;
      offData();
      els.refresh.removeEventListener('click', onRefresh);
    };
  }
});
