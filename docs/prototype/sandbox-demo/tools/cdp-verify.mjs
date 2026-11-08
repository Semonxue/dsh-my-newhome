#!/usr/bin/env node
/**
 * 可选：无头 Chrome 确定性取证脚本（只依赖 Node 内置能力，不是 demo 运行所需）
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *   `--virtual-time-budget=N --screenshot/--dump-dom` 会让渲染器用「虚拟时间」快进，
 *   而 srcdoc iframe 是独立的 opaque-origin 文档（Chrome 会把它放进单独的渲染进程），
 *   宿主 ↔ iframe 的 postMessage 是跨进程 IPC，真实耗时没有被虚拟时间覆盖：
 *   预算耗尽的一瞬间可能只处理了一部分消息，截图 / dump-dom 会抖动（表现是某个
 *   iframe 空白、或者探针结果没进宿主 DOM）。本脚本改成「真实等待 + CDP 取证」：
 *     1. 等 3.5s 让所有实例完成 ready → init → render → mount → 探针回传
 *     2. Page.captureScreenshot 截屏
 *     3. Runtime.evaluate 抓宿主 DOM + __DSH_SANDBOX_POC__.getState()
 *     4. Target.setAutoAttach 挂上 OOPIF，进 iframe 内部抓 innerText（可选）
 *   结果写进 --out 目录。
 *
 * 用法：
 *   node tools/cdp-verify.mjs [--url=http://127.0.0.1:8099/?auto=allow] [--out=/tmp/verify]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] || true] : [a, true];
}));
const URL_ = args.url || 'http://127.0.0.1:8099/?auto=allow';
const OUT = args.out || '/tmp/dsh-sandbox-verify';
const WAIT = Number(args.wait || 3500);
const PORT = Number(args.port || (9300 + Math.floor(Math.random() * 500)));

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-crash-reporter',
  `--user-data-dir=/tmp/dshw-cdp-${process.pid}`,
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  URL_
], { stdio: 'ignore' });

async function waitForJson(url, timeout = 15000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (err) { /* not up yet */ }
    if (Date.now() - started > timeout) throw new Error('CDP endpoint timeout: ' + url);
    await delay(150);
  }
}

const version = await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
const targets = await waitForJson(`http://127.0.0.1:${PORT}/json/list`);
const pageTarget = targets.find((t) => t.type === 'page');
if (!pageTarget) throw new Error('no page target');

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('ws error'));
});

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
/* headless=new 下 --window-size 不等于页面 viewport，这里强制成设计尺寸 1440×900 */
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
});
/* 沙箱 iframe 是 opaque origin，Chrome 会把它隔离成 OOPIF → auto-attach 才能进去取证 */
await send('Target.setAutoAttach', {
  autoAttach: true, waitForDebuggerOnStart: false, flatten: true
}).catch(() => {});

/* 真实等待：让 ready → init → mount → 探针回传全部落地 */
await delay(WAIT);

async function evaluate(expression, sessionId) {
  const res = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  }, sessionId);
  if (res.exceptionDetails) return { error: res.exceptionDetails.text };
  return res.result.value;
}

/* 宿主 DOM / 状态 */
const href = await evaluate('location.href');
const hostHtml = await evaluate('document.documentElement.outerHTML');
const hostState = await evaluate(`(() => {
  const api = window.__DSH_SANDBOX_POC__;
  return api ? JSON.stringify(api.getState()) : null;
})()`);

/* 宿主布局尺子：确认画布没溢出 / 每个 slot 的实际位置 */
const layout = await evaluate(`(() => {
  const rect = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    canvas: rect('.canvas'),
    grid: rect('#canvas-grid'),
    gridOverflow: (() => { const g = document.querySelector('#canvas-grid'); return g ? g.scrollHeight + '/' + g.clientHeight : null; })(),
    slots: [...document.querySelectorAll('#canvas-grid .slot')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cssW: el.style.width };
    }),
    placeholder: rect('.slot-placeholder'),
    info: rect('.info-card'),
    foot: rect('.canvas-foot'),
    probe: rect('.probe'),
    probeOverflow: [...document.querySelectorAll('.probe-col')].map((el) => el.scrollHeight + '/' + el.clientHeight)
  };
})()`);

/* OOPIF（每个沙箱 iframe）内部真实文本 —— 能拿到就拿到，拿不到不阻塞 */
const oopifs = events
  .filter((e) => e.method === 'Target.attachedToTarget' && e.params.sessionId)
  .map((e) => ({ sessionId: e.params.sessionId, targetInfo: e.params.targetInfo }));
const frames = [];
for (const oopif of oopifs) {
  try {
    await send('Runtime.enable', {}, oopif.sessionId);
    const info = await evaluate(`(() => {
      const root = document.getElementById('dsh-root');
      const w = root && root.querySelector('.w');
      const r = w ? w.getBoundingClientRect() : null;
      const cs = getComputedStyle(document.documentElement);
      return {
        url: location.href,
        origin: String(location.origin),
        theme: document.documentElement.getAttribute('data-theme'),
        innerText: root ? String(root.innerText).replace(/\\s+/g, ' ').trim().slice(0, 1200) : null,
        widgetClass: w ? w.className : null,
        size: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null,
        tokenApplied: cs.getPropertyValue('--tx-1').trim()
      };
    })()`, oopif.sessionId);
    frames.push({ target: oopif.targetInfo.url, ...info });
  } catch (err) {
    frames.push({ target: oopif.targetInfo.url, error: String(err.message || err) });
  }
}

/* 截图 */
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/screenshot.png`, Buffer.from(shot.data, 'base64'));
writeFileSync(`${OUT}/host-dom.html`, hostHtml || '');
writeFileSync(`${OUT}/host-state.json`, hostState || 'null');
writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames, null, 2));

/* console 报错（过滤 favicon 噪音） */
const consoleMsgs = events
  .filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded')
  .map((e) => {
    if (e.method === 'Log.entryAdded') {
      return { level: e.params.entry.level, text: e.params.entry.text, url: e.params.entry.url };
    }
    return {
      level: e.params.type,
      text: e.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    };
  })
  .filter((m) => (m.level === 'error' || m.level === 'warning')
    && !/favicon/i.test(m.text) && !/favicon/i.test(m.url || ''));
writeFileSync(`${OUT}/console.json`, JSON.stringify(consoleMsgs, null, 2));

const host = JSON.parse(hostState || 'null');
const summary = {
  chrome: version.Browser,
  href,
  frames: frames.map((f) => ({
    origin: f.origin,
    size: f.size,
    widgetClass: f.widgetClass,
    tokenApplied: f.tokenApplied,
    text: f.innerText ? f.innerText.slice(0, 300) : f.error
  })),
  probeStats: host && host.probeStats,
  instances: host && host.instances.map((i) => ({
    id: i.id, ready: i.ready, granted: i.granted, denied: i.denied,
    requests: i.requests, probes: i.probes ? i.probes.length : 0,
    notifies: i.notifies, errors: i.errors
  })),
  probes: host && host.instances.filter((i) => i.probes).map((i) => i.probes),
  hostErrors: host && host.hostErrors,
  consoleErrors: consoleMsgs
};
writeFileSync(`${OUT}/layout.json`, JSON.stringify(layout, null, 2));
summary.layout = layout;
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

ws.close();
chrome.kill('SIGKILL');
process.exit(0);
