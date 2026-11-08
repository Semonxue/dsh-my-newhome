/*!
 * 组件包：evil-demo v1.0.0
 * ---------------------------------------------------------------------------
 * 故意越界的示例组件：它在 iframe 里尝试一切「读宿主」的路子，并把每一项的
 * 结果（成功 / 抛错类型）画进自己的卡片，同时通过 DSH_WIDGET.reportProbe()
 * 回传宿主，让宿主 DOM 里也能取证。
 *
 * 预期：全部失败。任何一项显示「成功」都说明沙箱边界破了。
 * 注意：这是 iframe 的 opaque origin + sandbox="allow-scripts" + CSP 三重限制，
 * 不是靠「组件作者自觉」实现的隔离。
 */

const STYLE = `
.w-evil { padding: 10px 12px; border-color: color-mix(in srgb, var(--red) 38%, var(--bd-1)); }
.w-evil .w-head { gap: 7px; }
.w-evil .w-title { color: var(--red); }
.w-evil-rows { flex: 1; min-height: 0; margin-top: 6px; overflow: hidden; }
.w-evil-row {
  display: flex; align-items: center; gap: 6px;
  height: 16px;
  font-family: var(--mono);
  font-size: 8.5px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd-1) 55%, transparent);
}
.w-evil-name { flex: none; width: 168px; color: var(--tx-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w-evil-res {
  flex: none; width: 46px;
  font-family: var(--font); font-size: 8.5px; font-weight: 600;
  color: var(--amber);
  text-align: center;
  border-radius: 3px;
  padding: 0 3px;
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}
.w-evil-res[data-ok="false"] { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
.w-evil-res[data-ok="true"] { color: #fff; background: var(--red); }
.w-evil-detail { flex: 1; min-width: 0; color: var(--tx-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w-evil-foot {
  display: flex; align-items: center; gap: 5px;
  margin-top: 6px;
  font-size: 8.5px;
  color: var(--tx-3);
  font-family: var(--mono);
  overflow: hidden; white-space: nowrap;
}
.w-evil-foot b { color: var(--tx-2); font-weight: 500; }
`;

/* 每一项返回「越权拿到的值」；拿不到就必须抛错，抛错的 name 会显示出来。 */
const ATTEMPTS = [
  {
    name: 'parent.document',
    run() {
      const doc = parent.document;          // 跨源访问：应抛 SecurityError
      return '拿到 ' + doc.body.innerHTML.length + ' 字符';
    }
  },
  {
    name: 'top.location',
    run() {
      const href = top.location.href;      // 读：跨源 SecurityError
      top.location.href = 'about:blank#probe'; // 写：同样 SecurityError
      return href;
    }
  },
  {
    name: 'document.cookie',
    run() {
      document.cookie = 'dsh_probe=1';     // sandbox 无 allow-same-origin：读写都抛
      return 'cookie=' + document.cookie;
    }
  },
  {
    name: 'localStorage',
    run() {
      const v = localStorage.getItem('dsh-probe'); // 属性访问即抛 SecurityError
      localStorage.setItem('dsh-probe', '1');
      return '读到 ' + v;
    }
  },
  {
    name: "fetch('127.0.0.1:8080')",
    async run() {
      const res = await Promise.race([
        fetch('http://127.0.0.1:8080/', { mode: 'no-cors', cache: 'no-store' }),
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('E_TIMEOUT: 2.5s 未返回')); }, 2500);
        })
      ]);
      return 'HTTP ' + res.type;
    }
  },
  {
    name: 'window.DSH_*（宿主全局）',
    run() {
      const names = ['DSH_HOST', 'DSH_SESSION', 'DSH_USAGE', 'DSH_TOKEN', 'DSH_WORKSPACE', '__DSH__'];
      const found = names.filter(function (n) { return typeof window[n] !== 'undefined'; });
      if (found.length) return '可见：' + found.join(',');
      throw new Error('SecurityError · 6 个宿主全局均 undefined（只有契约 API DSH_WIDGET）');
    }
  },
  {
    /* 注意：sendBeacon 的返回值只表示「入队成功」，CSP 是在真正发送阶段才拦截，
       所以只要请求没有送达，就按「被拦截」算 —— 控制台会看到 Refused to connect。 */
    name: 'navigator.sendBeacon',
    run() {
      const queued = navigator.sendBeacon('http://127.0.0.1:8080/beacon', 'dsh-probe');
      throw new Error((queued ? 'API 返回 true，但 ' : 'API 返回 false，') +
        'CSP connect-src 在发送阶段拦截（控制台可见 Refused to connect）');
    }
  }
];

function errText(err) {
  if (!err) return 'unknown';
  const name = (err && err.name) || 'Error';
  let msg = (err && err.message) || String(err);
  msg = String(msg).split('\n')[0].slice(0, 78);
  return name + ' · ' + msg;
}

DSH_WIDGET.define({
  id: 'evil-demo',
  name: '深渊组件 · 安全探针',
  version: '1.0.0',
  author: 'dsh-sandbox-demo',
  description: '故意尝试跨文档 / Cookie / 存储 / 网络 / 宿主全局，全部应失败。',
  permissions: [],
  grid: { w: 5, h: 3, minW: 4, minH: 3, maxW: 10, maxH: 4 },

  render(ctx) {
    const rows = ATTEMPTS.map(function (a) {
      return [
        '<div class="w-evil-row" data-row="' + a.name + '">',
        '  <span class="w-evil-name">' + a.name + '</span>',
        '  <span class="w-evil-res" data-res>检测中</span>',
        '  <span class="w-evil-detail" data-detail>…</span>',
        '</div>'
      ].join('');
    }).join('');
    return [
      '<style>' + STYLE + '</style>',
      '<div class="w w-card w-evil" data-widget="evil-demo">',
      '  <div class="w-head">',
      '    <span class="w-mark" style="background:linear-gradient(135deg,var(--red),var(--amber))">!</span>',
      '    <span class="w-head-main">',
      '      <span class="w-title">evil-demo · 越权探针</span>',
      '      <span class="w-meta">sandbox=&quot;allow-scripts&quot; · 无 allow-same-origin</span>',
      '    </span>',
      '    <span class="w-chip" data-count>0/' + ATTEMPTS.length + ' 成功</span>',
      '  </div>',
      '  <div class="w-evil-rows">' + rows + '</div>',
      '  <div class="w-evil-foot"><b>结论：</b>全部被拦 → 越权通道只剩 postMessage 桥，且桥只回传文本结果</div>',
      '</div>'
    ].join('\n');
  },

  mount(root, ctx) {
    const countEl = root.querySelector('[data-count]');
    const nodes = {};
    root.querySelectorAll('[data-row]').forEach(function (row) {
      nodes[row.getAttribute('data-row')] = {
        res: row.querySelector('[data-res]'),
        detail: row.querySelector('[data-detail]')
      };
    });
    let alive = true;

    async function runAll() {
      const results = await Promise.all(ATTEMPTS.map(async function (a) {
        try {
          const value = await a.run();
          return { name: a.name, ok: true, detail: String(value == null ? 'ok' : value) };
        } catch (err) {
          return { name: a.name, ok: false, detail: errText(err) };
        }
      }));
      if (!alive) return;
      results.forEach(function (r) {
        const n = nodes[r.name];
        if (!n) return;
        n.res.textContent = r.ok ? '成功' : '拦截';
        n.res.dataset.ok = String(r.ok);
        n.detail.textContent = r.detail;
        n.detail.title = r.detail;
      });
      const wins = results.filter(function (r) { return r.ok; }).length;
      countEl.textContent = wins + '/' + results.length + ' 成功';
      countEl.style.color = wins ? 'var(--red)' : 'var(--green)';
      DSH_WIDGET.reportProbe(results);
    }

    runAll().catch(function (err) {
      if (!alive) return;
      countEl.textContent = '探针脚本失败';
      DSH_WIDGET.notify('error', 'evil-demo 探针执行失败：' + errText(err));
    });

    return () => { alive = false; };
  }
});
