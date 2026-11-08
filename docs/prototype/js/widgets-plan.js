/*!
 * DSH 自定义主页静态原型 · base + plan 组件库（作者 A）
 * ------------------------------------------------------------------
 * 依赖：styles/base.css 给出的 .w / .w-card / .w-bare 等公共类与主题 token
 * 导出：window.DSH_WIDGETS_BASE_PLAN（12 个组件）
 * 约束：纯原生 ES2020，无 import/export、无外部字体/图片/请求、无全局 id、
 *       组件内部交互一律 data-nodrag，mount 必须返回 cleanup。
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------
   * 内联图标（currentColor 描边，无外部资源）
   * ------------------------------------------------------------- */
  const ICON = {
    plus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3.5 7.5A1.6 1.6 0 0 1 5.1 5.9h4l2.1 2.6h7.7a1.6 1.6 0 0 1 1.6 1.6v6.4a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z"/></svg>',
    sliders:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" aria-hidden="true">' +
      '<path d="M4 7.5h9.2M18.2 7.5H20M4 16.5h2.3M11.3 16.5H20"/>' +
      '<circle cx="15.7" cy="7.5" r="2.1"/><circle cx="8.8" cy="16.5" r="2.1"/></svg>',
    gear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/></svg>'
  };

  // DSH 官方品牌标记（鲸鱼），取自 DSH 0.2.2-rc.1 favicon.svg，单色 currentColor
  const WHALE_PATH =
    'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

  /* ---------------------------------------------------------------
   * 演示数据（全部写死；variant 轮换保证重复添加时内容不同）
   * ------------------------------------------------------------- */
  const WORKSPACES = [
    {
      name: 'acme-web',
      meta: '2 个会话 · 2 小时前',
      mark: 'A',
      grad: 'linear-gradient(135deg,var(--green),var(--cyan))'
    },
    {
      name: 'data-lab',
      meta: '14 个会话 · 4 小时前',
      mark: 'D',
      grad: 'linear-gradient(135deg,var(--brand),var(--cyan))'
    },
    {
      name: 'notes-app',
      meta: '29 个会话 · 昨天',
      mark: 'N',
      grad: 'linear-gradient(135deg,var(--amber),var(--red))'
    },
    {
      name: 'video-pipeline',
      meta: '78 个会话 · 3 天前',
      mark: 'V',
      grad: 'linear-gradient(135deg,var(--cyan),var(--brand-2))'
    },
    {
      name: 'content-ops',
      meta: '46 个会话 · 6 天前',
      mark: 'C',
      grad: 'linear-gradient(135deg,var(--violet),var(--pink))'
    },
    {
      name: 'acme-web-plugin',
      meta: '16 个会话 · 9 天前',
      mark: 'A',
      grad: 'linear-gradient(135deg,var(--pink),var(--violet))'
    }
  ];

  const LINKS = [
    {
      name: 'GitHub',
      domain: 'github.com',
      mark: 'G',
      grad: 'linear-gradient(135deg,var(--bd-2),var(--bd-3))',
      fg: 'var(--tx-1)'
    },
    {
      name: 'MDN',
      domain: 'developer.mozilla.org',
      mark: 'M',
      grad: 'linear-gradient(135deg,var(--brand),var(--brand-2))',
      fg: '#fff'
    },
    {
      name: 'Stack Overflow',
      domain: 'stackoverflow.com',
      mark: 'S',
      grad: 'linear-gradient(135deg,var(--amber),var(--red))',
      fg: '#fff'
    },
    {
      name: 'Figma',
      domain: 'figma.com',
      mark: 'F',
      grad: 'linear-gradient(135deg,var(--violet),var(--pink))',
      fg: '#fff'
    },
    {
      name: 'YouTube',
      domain: 'youtube.com',
      mark: 'Y',
      grad: 'linear-gradient(135deg,var(--red),var(--pink))',
      fg: '#fff'
    },
    {
      name: 'Hacker News',
      domain: 'news.ycombinator.com',
      mark: 'H',
      grad: 'linear-gradient(135deg,var(--amber),var(--pink))',
      fg: '#fff'
    }
  ];

  const ACTIONS = [
    { key: 'new', label: '新建会话', icon: ICON.plus },
    { key: 'workspace', label: '打开工作区', icon: ICON.folder },
    { key: 'custom', label: '自定义主页', icon: ICON.sliders }
  ];

  const NOTES = [
    { text: '整理本周研究笔记', done: false },
    { text: '给 rates 组件补浅色主题', done: false },
    { text: '评审 pad-pc 的组件', done: true },
    { text: '写一篇自定义主页说明', done: false }
  ];

  /* ---------------------------------------------------------------
   * 小工具
   * ------------------------------------------------------------- */
  function pickVariant(list, ctx) {
    const variant = ctx && typeof ctx.variant === 'number' ? ctx.variant : 0;
    return list[((variant % list.length) + list.length) % list.length];
  }

  function clampPct(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  /** 用量卡公共骨架：DeepSeek / MiniMax / Cline / OpenCode 复用 */
  function usageHTML(o) {
    const tone = o.tone ? ' data-tone="' + o.tone + '"' : '';
    const track =
      typeof o.pct === 'number'
        ? '<div class="w-usage-track" aria-hidden="true">' +
          '<span class="w-usage-fill" style="width:' + clampPct(o.pct) + '%"></span></div>'
        : '';
    return (
      '<div class="w w-card w-usage w-usage-' + o.key + '"' + tone + '>' +
      '<div class="w-usage-head">' +
      '<span class="w-usage-dot" style="background:' + o.grad + '" aria-hidden="true">' +
      o.initial +
      '</span>' +
      '<span class="w-usage-name">' + o.name + '</span>' +
      '</div>' +
      '<div class="w-usage-mid">' +
      '<span class="w-usage-big">' + o.big + '</span>' +
      '<span class="w-usage-unit">' + o.unit + '</span>' +
      '</div>' +
      track +
      '<div class="w-usage-foot">' + o.foot + '</div>' +
      '</div>'
    );
  }

  /* ---------------------------------------------------------------
   * 组件库
   * ------------------------------------------------------------- */
  window.DSH_WIDGETS_BASE_PLAN = [
    /* ============================ base ============================ */
    {
      id: 'dsh-logo',
      name: 'DSH 标识',
      category: 'base',
      desc: '官方鲸鱼 / 品牌方块',
      w: 4,
      h: 4,
      minW: 2,
      minH: 2,
      maxW: 12,
      maxH: 12,
      render(ctx) {
        const variant = ctx && typeof ctx.variant === 'number' ? ctx.variant : 0;
        const mode = ((variant % 3) + 3) % 3;
        const whale =
          '<svg class="w-logo-whale" viewBox="0 0 50 50" fill="currentColor" aria-hidden="true"><path d="' +
          WHALE_PATH +
          '"/></svg>';
        if (mode === 1) {
          // onboarding 渐变方块 + 白色鲸鱼（插件当前视觉）
          return (
            '<div class="w w-bare w-logo w-logo--tile" role="img" aria-label="DeepSeek Harness">' +
            '<div class="w-logo-box">' + whale + '</div>' +
            '</div>'
          );
        }
        if (mode === 2) {
          // 纯渐变方块（历史上的占位 Logo）
          return (
            '<div class="w w-bare w-logo" role="img" aria-label="DeepSeek Harness">' +
            '<div class="w-logo-box"></div>' +
            '</div>'
          );
        }
        // 0：DSH 官方单色鲸鱼
        return (
          '<div class="w w-bare w-logo w-logo--whale" role="img" aria-label="DeepSeek Harness">' +
          whale +
          '</div>'
        );
      }
    },
    {
      id: 'tagline',
      name: '标语',
      category: 'base',
      desc: '主页大标语',
      w: 10,
      h: 2,
      minW: 4,
      minH: 1,
      maxW: 20,
      maxH: 3,
      render(ctx) {
        void ctx;
        return (
          '<div class="w w-bare w-tagline">' +
          '<span class="w-tagline-text">探索未至之境</span>' +
          '</div>'
        );
      }
    },
    {
      id: 'quick-actions',
      name: '快捷操作',
      category: 'base',
      desc: '新建会话等快捷入口',
      w: 8,
      h: 2,
      minW: 6,
      minH: 2,
      maxW: 16,
      maxH: 3,
      render(ctx) {
        void ctx;
        const buttons = ACTIONS.map(function (action) {
          return (
            '<button type="button" class="w-quick-btn" data-nodrag data-action="' +
            action.key +
            '" title="' + action.label + '" aria-label="' + action.label + '">' +
            '<span class="w-quick-ico" aria-hidden="true">' + action.icon + '</span>' +
            '<span class="w-quick-label">' + action.label + '</span>' +
            '</button>'
          );
        }).join('');
        return '<div class="w w-bare w-quick">' + buttons + '</div>';
      },
      mount(root) {
        const timers = new Set();
        const onClick = function (event) {
          const target = event.target;
          const btn = target && target.closest ? target.closest('.w-quick-btn') : null;
          if (!btn || !root.contains(btn)) return;
          btn.classList.add('is-tapped');
          const timer = setTimeout(function () {
            btn.classList.remove('is-tapped');
            timers.delete(timer);
          }, 280);
          timers.add(timer);
        };
        root.addEventListener('click', onClick);
        return function cleanup() {
          root.removeEventListener('click', onClick);
          timers.forEach(clearTimeout);
          timers.clear();
        };
      }
    },
    {
      id: 'section-label',
      name: '分组标题',
      category: 'base',
      desc: '一行分组小标题',
      w: 6,
      h: 1,
      minW: 3,
      minH: 1,
      maxW: 16,
      maxH: 2,
      render(ctx) {
        // 同一布局里会放多个分组标题：按 variant % 3 轮换文案与计数
        const groups = [
          { text: '最近工作区', count: 6 },
          { text: '用量概览', count: 3 },
          { text: '常用站点', count: 6 }
        ];
        const variant = ctx && typeof ctx.variant === 'number' ? ctx.variant : 0;
        const group = groups[((variant % groups.length) + groups.length) % groups.length];
        return (
          '<div class="w w-bare w-sec-label">' +
          '<span class="w-sec-label-text">' + group.text + '</span>' +
          '<span class="w-sec-label-chip">' + group.count + '</span>' +
          '</div>'
        );
      }
    },

    /* ============================ plan ============================ */
    {
      id: 'workspace-card',
      name: '工作区卡片',
      category: 'plan',
      desc: '最近使用的工作区',
      w: 7,
      h: 2,
      minW: 5,
      minH: 2,
      maxW: 14,
      maxH: 3,
      render(ctx) {
        const item = pickVariant(WORKSPACES, ctx);
        return (
          '<div class="w w-card w-workspace">' +
          '<div class="w-workspace-row">' +
          '<span class="w-mark w-workspace-mark" style="background:' + item.grad + '">' +
          item.mark +
          '</span>' +
          '<span class="w-workspace-text">' +
          '<span class="w-title w-workspace-name">' + item.name + '</span>' +
          '<span class="w-meta w-workspace-meta">' + item.meta + '</span>' +
          '</span>' +
          '</div>' +
          '</div>'
        );
      }
    },
    {
      id: 'link-card',
      name: '常用站点',
      category: 'plan',
      desc: '常用站点快捷入口',
      w: 7,
      h: 2,
      minW: 5,
      minH: 2,
      maxW: 14,
      maxH: 3,
      render(ctx) {
        const item = pickVariant(LINKS, ctx);
        return (
          '<div class="w w-card w-link">' +
          '<div class="w-link-row">' +
          '<span class="w-mark w-link-mark" style="background:' + item.grad +
          ';color:' + item.fg + '">' + item.mark + '</span>' +
          '<span class="w-link-text">' +
          '<span class="w-title w-link-name">' + item.name + '</span>' +
          '<span class="w-meta w-link-meta">' + item.domain + '</span>' +
          '</span>' +
          '</div>' +
          '</div>'
        );
      }
    },
    {
      id: 'usage-deepseek',
      name: '用量 · DeepSeek',
      category: 'plan',
      desc: 'DeepSeek 余额',
      w: 7,
      h: 2,
      minW: 5,
      minH: 2,
      maxW: 14,
      maxH: 3,
      render() {
        return usageHTML({
          key: 'deepseek',
          name: 'DeepSeek',
          initial: 'D',
          grad: 'linear-gradient(135deg,var(--brand),var(--brand-2))',
          big: '¥12.34',
          unit: '余额',
          foot: '充值 ¥12.34 · 赠送 ¥0.00'
        });
      }
    },
    {
      id: 'usage-minimax',
      name: '用量 · MiniMax',
      category: 'plan',
      desc: 'MiniMax 窗口用量',
      w: 7,
      h: 2,
      minW: 5,
      minH: 2,
      maxW: 14,
      maxH: 3,
      render() {
        return usageHTML({
          key: 'minimax',
          name: 'MiniMax',
          initial: 'M',
          grad: 'linear-gradient(135deg,var(--amber),var(--red))',
          big: '23%',
          unit: '5 小时',
          foot: '本周 9% · 2 小时 14 分后重置',
          pct: 23
        });
      }
    },
    {
      id: 'usage-cline',
      name: '用量 · Cline Pass',
      category: 'plan',
      desc: 'Cline Pass 月用量',
      w: 7,
      h: 2,
      minW: 5,
      minH: 2,
      maxW: 14,
      maxH: 3,
      render() {
        return usageHTML({
          key: 'cline',
          name: 'Cline Pass',
          initial: 'C',
          grad: 'linear-gradient(135deg,var(--cyan),var(--brand))',
          big: '35%',
          unit: '本月已用',
          foot: '5 小时 22% · 本周 9%',
          pct: 35
        });
      }
    },
    {
      id: 'settings-entry',
      name: '自定义主页入口',
      category: 'plan',
      desc: '自定义主页设置入口',
      w: 6,
      h: 2,
      minW: 5,
      minH: 2,
      maxW: 12,
      maxH: 3,
      render() {
        return (
          '<div class="w w-card w-settings">' +
          '<div class="w-settings-row">' +
          '<span class="w-settings-ico" aria-hidden="true">' + ICON.gear + '</span>' +
          '<span class="w-settings-text">' +
          '<span class="w-title w-settings-title">自定义主页</span>' +
          '<span class="w-meta w-settings-meta">配色 / 背景 / 组件</span>' +
          '</span>' +
          '<button type="button" class="w-settings-open" data-nodrag ' +
          'title="打开自定义主页设置" aria-label="打开自定义主页设置">打开</button>' +
          '</div>' +
          '</div>'
        );
      },
      mount(root) {
        const btn = root.querySelector('.w-settings-open');
        if (!btn) return function cleanup() {};
        let timer = 0;
        const onClick = function () {
          if (btn.dataset.busy === '1') return;
          btn.dataset.busy = '1';
          btn.classList.add('is-open');
          btn.textContent = '已打开';
          timer = setTimeout(function () {
            btn.classList.remove('is-open');
            btn.textContent = '打开';
            btn.dataset.busy = '';
            timer = 0;
          }, 1100);
        };
        btn.addEventListener('click', onClick);
        return function cleanup() {
          clearTimeout(timer);
          btn.removeEventListener('click', onClick);
        };
      }
    },
    {
      id: 'custom-note',
      name: '自定义便签',
      category: 'plan',
      desc: '今日速记待办',
      w: 7,
      h: 3,
      minW: 5,
      minH: 3,
      maxW: 14,
      maxH: 6,
      render() {
        const rows = NOTES.map(function (note) {
          return (
            '<label class="w-note-row" data-nodrag>' +
            '<input type="checkbox" class="w-note-check" data-nodrag' +
            (note.done ? ' checked' : '') + ' aria-label="' + note.text + '">' +
            '<span class="w-note-text">' + note.text + '</span>' +
            '</label>'
          );
        }).join('');
        return (
          '<div class="w w-card w-note">' +
          '<div class="w-note-head">' +
          '<span class="w-note-title">今日速记</span>' +
          '<span class="w-spacer"></span>' +
          '<button type="button" class="w-note-add" data-nodrag ' +
          'title="新建速记" aria-label="新建速记">+</button>' +
          '</div>' +
          '<div class="w-note-list">' + rows + '</div>' +
          '</div>'
        );
      },
      mount(root) {
        const list = root.querySelector('.w-note-list');
        const addBtn = root.querySelector('.w-note-add');
        if (!list || !addBtn) return function cleanup() {};
        const onAdd = function () {
          if (list.children.length >= 8) return;
          const row = document.createElement('label');
          row.className = 'w-note-row is-new';
          row.setAttribute('data-nodrag', '');
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.className = 'w-note-check';
          check.setAttribute('data-nodrag', '');
          check.setAttribute('aria-label', '新增速记');
          const text = document.createElement('span');
          text.className = 'w-note-text';
          text.textContent = '新增速记';
          row.appendChild(check);
          row.appendChild(text);
          // 插到最前面：默认高度只显示前几行，这样「+」一定有可见反馈
          list.insertBefore(row, list.firstChild);
          while (list.children.length > 8) {
            list.removeChild(list.lastChild);
          }
        };
        addBtn.addEventListener('click', onAdd);
        return function cleanup() {
          addBtn.removeEventListener('click', onAdd);
        };
      }
    },
    {
      id: 'usage-opencode',
      name: '用量 · OpenCode Go',
      category: 'plan',
      desc: 'OpenCode Go 用量',
      w: 7,
      h: 2,
      minW: 5,
      minH: 2,
      maxW: 14,
      maxH: 3,
      render() {
        return usageHTML({
          key: 'opencode',
          name: 'OpenCode Go',
          initial: 'O',
          grad: 'linear-gradient(135deg,var(--violet),var(--cyan))',
          big: '62%',
          unit: '5 小时',
          foot: '本周 41% · 本机 token 1.24M',
          pct: 62,
          tone: 'warn'
        });
      }
    }
  ];
})();
