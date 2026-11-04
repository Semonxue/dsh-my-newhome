# Research: how DSH renders `conversation.input.dock` (and why a crashed entry vanishes)

> Sanitized: local absolute paths and scratch directories are abstracted; technical findings unchanged.

Research task delegated to a research subagent. Research only — no `lib/*.js` was modified.

**App under study:** `/Applications/DeepSeek Harness.app` (asar built 2025-10-29).
**Plugin snapshot used for the client-side citations:** `lib/client.js` from one build snapshot taken
during this research, sha256 `63705e95…` — **that file was being edited concurrently while this
research ran**, so plugin line numbers drift; re-check them against the final file. Harness line
numbers (asar packages) are stable for this build.

Everything below was read from the packaged app, not guessed. Extraction:

```bash
node <scratch>/asar-list.mjs "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" <substr>
node <scratch>/asar-extract.mjs "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" \
  "/dsh/node_modules/@deepseek-ai/<pkg>/" <asar-extract>/<pkg>/
```

---

## 0. Where the slot system actually lives

There is **no standalone `dsh-client-ui-slots` package on disk** — the asar lister returns 0 files for
it. The slot **core** is compiled into the built shell bundle as a *static module*, and the slot
**renderer** is a normal client package that `require`s it:

- `<asar-extract>/dsh-web-frontend/assets/index-BXV-oxvX.js:190` — static module table handed to the
  module loader:
  ```js
  staticModules:OZ()   // OZ() returns { "react": …, "@deepseek-ai/dsh-client-ui-slots": jI, … }
  ```
- `<asar-extract>/dsh-web-frontend/assets/index-BXV-oxvX.js:120` — `SlotCore` (register / sort /
  abdication / versioning), exported as `jI`:
  ```js
  const jI=Object.freeze(Object.defineProperty({__proto__:null,SlotCore:SI,…,standardHookPropName:kI},…))
  ```
- `<asar-extract>/dsh-client-ui-renderer/lib/client.js` — **`renderSlot` / `SlotOutlet` /
  `SlotErrorBoundary`** (this is the file to read for slot rendering semantics).
- `grep -c composerStack` in the shell bundle = **0**; `grep -c renderSlot` = **0**. The composer
  comes from `@deepseek-ai/dsh-client-ui-conversation`, not from the shell.

---

## 1. How `ctx.slots.register({name,id,order}, Component)` renders — wrapper or not?

Chain: `register()` → core stores an entry → the outlet's `renderSlot(key)` call is bound per
declaring entry → `SlotOutlet` renders one anchor element for the whole slot → the list kind maps
entries to components **with no per-entry wrapper**.

**a. `renderSlot` (props face) returns a `SlotOutlet` element**

`<asar-extract>/dsh-client-ui-renderer/lib/client.js:342-358`
```js
function boundRenderSlot(host, entry) {
  … return (0, react_jsx_runtime.jsx)(SlotOutlet, {
        slotKey: key, ownerProps: owner, opts, declaredInline: declared.inline === true })
```

**b. `SlotOutlet` = ONE wrapper element per slot occurrence, and it is layout-transparent**

`<asar-extract>/dsh-client-ui-renderer/lib/client.js:1110-1127`
```js
/** Anchor style shared by every outlet wrapper: `display:contents` keeps the
 * wrapper out of layout (grid/flex parents see the slot's own children) … */
const ANCHOR_STYLE = { display: "contents" };
function SlotOutlet({ slotKey, ownerProps, opts, declaredInline }) {
  …
  return (0, react_jsx_runtime.jsx)((spec === void 0 ? declaredInline : spec.inline === true) ? "span" : "div", {
    "data-slot": slotKey,
    style: ANCHOR_STYLE,
    children: spec === void 0 ? null : renderOutletContent(host, slotKey, ownerProps, opts, scopeBinding, spec)
  });
}
```

**c. List kind: entries are rendered as siblings, each under its own error boundary, no wrapper**

`<asar-extract>/dsh-client-ui-renderer/lib/client.js:1203-1222`
```js
const rows = host.entriesOfSlot(slotKey).map((entry) => ({ entry, id: entry.options.id, order: entry.options.order ?? 0 }));
… let list = [...rows].sort((a, b) => a.order - b.order);
…
return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: list.map((item, i) =>
    item.entry !== void 0 ? guarded(item.entry, `e${entryKeyOf(item.entry)}`)
                          : (0, react_jsx_runtime.jsx)(Anchor, { "data-slot-error": slotKey }, `x${item.id ?? i}`)) });
```
and `renderEntry` just renders the component:

`<asar-extract>/dsh-client-ui-renderer/lib/client.js:792-797`
```js
function renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext) {
  if (slotInjected.slotHookFactories === void 0) return (0, react_jsx_runtime.jsx)(Comp, { ...kit, ...injected, ...slotInjected.props, ...ownerProps });
```

**Answer (Q1).** You get exactly one extra element for the whole slot —
`<div data-slot="conversation.input.dock" style="display:contents">` — and **zero wrapper element per
registered entry**. Because that wrapper is `display:contents`, each entry's own root element
(`<div class="dshh-deck">`, `<div class="dshh-footer">`, …) is laid out as a **direct child of the
flex container that hosts the slot** (`.composerStack`). So:

- for **layout** (flex items, `order`, `flex`, `gap`): entry roots behave as direct children of
  `.composerStack` ✔
- for **selectors** (`>` combinators, `:first-child`): they are *not* children of `.composerStack`;
  they are children of the `data-slot` div ✔ (`.composerStack > .dshh-deck` never matches;
  `[data-slot="conversation.input.dock"] > .dshh-deck` does)

---

## 2. What the integer `order` option controls (DOM order — not CSS)

The `order` option is applied **at registration time by the core**, as a stable sort of the slot's
entry array. It decides **DOM order**, and therefore also decides which entry wins for a duplicated
`id` cell.

`<asar-extract>/dsh-web-frontend/assets/index-BXV-oxvX.js:120` (SlotCore.register → entry list):
```js
u=[...r.entries,l];
if(u.sort(i.kind==="list"
   ? (h,p)=>(h.options.priority??0)-(p.options.priority??0)||(h.options.order??0)-(p.options.order??0)
   : (h,p)=>(h.options.priority??0)-(p.options.priority??0)),r.entries=u,…
```
- ascending `priority` first, then ascending `order`;
- the renderer sorts its row list by `order` again (`client.js:1218`) to interleave error placeholders;
- `entriesOfSlot` skips **abdicated** entries and de-duplicates by cell key (`key` for keyed,
  `id` for list), keeping the first winner:
  ```js
  entriesOfSlot(e){… if(r==="list"?s.options.id:void 0)… if(this.abdicated.has(s))continue;
     const l=r==="keyed"?s.options.key:r==="list"?s.options.id:void 0; n.has(l)||(n.add(l),i.push(s))}
  ```
  (`index-BXV-oxvX.js:120`; the same contract is documented in
  `<asar-extract>/dsh-client-ui-renderer/lib/client.js:1546-1551` — "Shadowing winners per cell for a
  key: the first live (non-abdicated) entry of each cell in priority order")

Built-in users of the same slot, for calibration:

| id | order | where |
|---|---|---|
| `todo` | `0` | `<asar-extract>/dsh-client-ui-conversation/lib/client.js:19501` |
| `dshh-workspaces` | `10` | plugin `lib/client.js:991` |
| `dshh-widgets` | `11` | plugin `lib/client.js:992` |
| `dshh-links` | `12` | plugin `lib/client.js:993` |
| `dshh-footer` | `13` | plugin `lib/client.js:994` |
| `queue` | `20` | `<asar-extract>/dsh-client-ui-conversation/lib/client.js:17267` |

**Answer (Q2).** `order` is **DOM order inside the slot**, never CSS. It is *not* a substitute for
CSS `order`, and it does not change z/gap. Conversely the plugin's CSS `order` values do nothing to
DOM order — they only re-sequence **flex items**, which works precisely because of §1's
`display:contents` wrapper. Tab order follows DOM (slot `order`), not CSS `order` — the two can
disagree (see §7).

---

## 3. `.composerStack` children — hero vs. active

`<asar-extract>/dsh-client-ui-conversation/lib/client.js:17896-17910`
```js
const composerBar = (0, react_jsx_runtime.jsxs)("div", {
  className: clsx(ConversationRoot_module_css_default.composerStack,
                  hero && ConversationRoot_module_css_default.composerHero),
  children: [
    hero && (0, react_jsx_runtime.jsx)(HeroShell, { t, renderSlot }),
    hero && heroWorkspaceRow,                                  // <div class="…heroWorkspaceRow"> (17851)
    zone !== void 0 && renderSlot("conversation.input.dock", zone),
    inputBar                                                   // renderSlot("conversation.composer.bar", …) (17885)
  ]
});
```
The slot's declaration (kind/scope) is:
`<asar-extract>/dsh-client-ui-conversation/lib/client.js:19953-19956`
```js
"conversation.input.dock": {
  kind: "list",
  scope: "session"
},
```
Container CSS (`<asar-extract>/dsh-client-ui-conversation/lib/client.js:17384`):
```css
.kiGsTW_composerStack{--dsh-composer-stack-gap:6px;gap:var(--dsh-composer-stack-gap);flex-direction:column;display:flex}
.kiGsTW_composerHero{…gap:8px;padding-bottom:32px}
.kiGsTW_heroWorkspaceRow{…margin-top:4px;…display:flex}
```
and the class-hash map is `"composerStack": "kiGsTW_composerStack"` (`…:17397`) — which is why the
plugin's `[class*="composerStack"]` / `[class*="composerHero"]` substring selectors match.

**Hero (new chat) state — DOM order the browser sees (D = direct DOM child):**

```
div.kiGsTW_composerStack.kiGsTW_composerHero
├─ D div  HeroShell root           (…/HeroShell_module_css_default.root, conversation:17762)
├─ D div  heroWorkspaceRow
├─ D div  data-slot="conversation.input.dock"  style="display:contents"   ← NOT a flex item
│    ├─ <todo dock root>            (order 0, may render null)
│    ├─ div.dshh-deck               (dshh-workspaces, 10)
│    ├─ div.dshh-deck.dshh-deck-widgets (dshh-widgets, 11)
│    ├─ div.dshh-deck.dshh-deck-links   (dshh-links, 12)
│    ├─ div.dshh-footer             (dshh-footer, 13)
│    └─ <queue dock root>           (order 20)
├─ D div  data-chain-overlay-fallback  style="display:contents"  ← composer.bar outlet chain
│    └─ D div data-slot="conversation.composer.bar" style="display:contents"
└─ D div  InputBar root
```
Actual **flex items** of `.composerStack` = `HeroShell root`, `heroWorkspaceRow`, each slot entry
root, `InputBar root`. The two `display:contents` anchors contribute no box.

**Active (real conversation) state:** same minus `HeroShell` and `heroWorkspaceRow`; `zone` is still
defined, so the dock still renders (the plugin hides its rows itself — see §5/§7).

**Answer (Q3).** Yes — confirmed: `[HeroShell, heroWorkspaceRow, renderSlot("conversation.input.dock"),
inputBar]`, but only the first two and the last are direct *DOM* children; the dock is one
`display:contents` wrapper whose entry roots become **flex items in the same container**. CSS `order`
on `.dshh-deck` / `.dshh-footer` therefore genuinely works.

Corollary: `[class*="composerStack"] > :first-child` (plugin `lib/client.js:1019`) matches
`HeroShell root` **only in hero state**; in the active state the first element child is the
`data-slot` anchor (display:contents → `order` is a no-op). Plan selectors accordingly.

---

## 4. Error handling: what happens when a slot component throws

**Per-entry `React` error boundary exists** — one instance per registered entry:

`<asar-extract>/dsh-client-ui-renderer/lib/client.js:622-646`
```js
/** Per-entry isolation: one registrant crashing (component render or inject
 * factory) must not take down siblings. Assembly errors (missing providers)
 * rethrow — a miswired shell must fail loud, not degrade into fallbacks. … */
var SlotErrorBoundary = class extends react.Component {
  state = { failed: false };
  static getDerivedStateFromError(error) {
    if (error instanceof SlotAssemblyError) throw error;
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error(`slot entry crashed in '${this.props.slotKey}':`, error);
    this.props.onEntryError(error);
  }
  render() {
    const Anchor = this.props.anchor ?? "div";
    if (this.state.failed) return (0, react_jsx_runtime.jsx)(Anchor, { "data-slot-error": this.props.slotKey });
    return this.props.children;
  }
};
```
It is mounted per entry in the list branch (`client.js:1139-1160`, `guarded()`), and the report path is
`onEntryError → host.reportEntryError(slot, entry, error, { abdicate: spec.kind !== "chain" })`
(`…:1140`, host face at `…:1656-1658`). The core then **abdicates** the entry:

`<asar-extract>/dsh-web-frontend/assets/index-BXV-oxvX.js:120`
```js
reportEntryError(e,t,r,i){ if(i.abdicate){ if(this.abdicated.has(t))return; this.abdicated.add(t);
  const n=this.records.get(e); n!==void 0&&this.markDirty(e,n) }
  for(const n of[...this.entryErrorListeners])n(e,t,r,{abdicated:i.abdicate}) }
```

Consequences, in order:

1. React unmounts **only that entry's subtree**. Siblings in the same slot and the rest of the app
   (composer, conversation, sidebar) keep rendering. A `SlotAssemblyError` is different: it is
   rethrown, i.e. miswired *declarations* fail loud — but a plain `ReferenceError`/`TypeError` in a
   plugin component is contained.
2. The crash face is an **empty** `<div data-slot-error="conversation.input.dock">` (the `Anchor`
   here carries no `display:contents`, so it stays a real, zero-height flex item and still eats one
   6 px `gap`).
3. The entry is **abdicated permanently for the life of the registration**: `entriesOfSlot` skips
   it, so it never retries on later renders. Fixing the code requires re-registering (plugin
   reload/HMR) or a page reload.
4. Diagnostics: `console.error("slot entry crashed in 'conversation.input.dock':", error)`, plus the
   plugin run surface. The cordis client runner subscribes to the ledger and attributes the crash to
   the owning plugin:
   `<asar-extract>/dsh-cordis-client-runner/lib/client.js:421-437`
   ```js
   this.unwatch = env.slots.onEntryError((slot, entry, error, info) => {
     … const failure = { slot, message: renderFailureMessage(slot, details.message), …, abdicated: info.abdicated };
     env.reportRenderFailure(owner.agentId, owner.pluginId, owner.pluginRunId, failure);
     this.failures.set(owner.pluginId, failure); this.notify();
   ```
   rendered as a per-plugin alert row:
   `<asar-extract>/dsh-client-ui-cordis/lib/client.js:1046-1051`
   ```js
   renderFailure !== void 0 && (0, react_jsx_runtime.jsx)("div", {
     className: CordisPanel_module_css_default.rowError, role: "alert",
     "data-cordis-render-failure": renderFailure.slot,
     "data-cordis-render-abdicated": renderFailure.abdicated || void 0, … })
   ```

**Answer (Q4).** Boundary is **per entry**, not per slot and not per region. The app does not break;
that one entry disappears silently in place (leaving an empty `data-slot-error` div), logs a
`console.error`, and — if the crashed component is attributable to a plugin — shows as a render-failure
row in the Cordis plugin panel. Nothing in the composer itself tells the user a row is missing.

---

## 5. The invisible "⚙ 自定义主页" entry — root cause

### Status of the reported defect

The report said: `FooterRow` calls `useDeckHidden(props, config)` (line 684) while only
`deckHidden(state, config)` (line 600) exists. **That defect is not present in the revision I read.**
Verified twice, seconds apart, on a file that another agent was actively rewriting (it kept growing
between the two reads; sha `63705e95…`):

```
$ grep -rn "useDeckHidden" <repo-root>   # → no matches
$ python3  # count of the substring in lib/client.js → useDeckHidden present: False
            # deckHidden count: 5 (1 definition + 4 call sites)
```
Current call sites (snapshot): definition `lib/client.js:677-682`, used at `:694` (WorkspaceRow),
`:738` (LinksRow), `:858` (WidgetsRow), `:870` (FooterRow):
```js
function FooterRow() {
  const current = useHomepage()
  if (deckHidden(current, current.config)) return null
  return h('div', { className: 'dshh-footer' },
    h('button', { type: 'button', className: 'dshh-gear', title: '自定义这个主页', onClick: openSettings },
      [h('span', { key: 'glyph' }, '⚙'), h('span', { key: 'text' }, '自定义主页')]))
}
```
So either the bug was fixed between the Lead's reading and mine, or the earlier reading was of a
different revision — **re-verify against the final merged file** before writing the changelog. A
scripted sweep of the snapshot for calls with no local definition found no suspicious identifier
(candidates were only `React.useX` hook locals, `ctx` verbs, CSS strings and `Math`-style globals).

### Exact runtime consequence *if* such a ReferenceError exists

Given §4, the behaviour is fully determined and matches the symptom "⚙ 自定义主页 is invisible:

1. `FooterRow` throws `ReferenceError: useDeckHidden is not defined` during its **first** render.
2. `SlotErrorBoundary` for the `dshh-footer` entry catches it → renders
   `<div data-slot-error="conversation.input.dock"></div>` in that slot row, i.e. **nothing visible**.
3. `.dshh-footer{order:1000}` never applies because the element never mounts — so no visible layout
   hole either (only one extra 6 px flex gap from the empty error anchor).
4. `console.error("slot entry crashed in 'conversation.input.dock':", ReferenceError…)` — the only
   immediate clue; the Cordis plugin panel shows a render-failure alert for `dsh-my-newhome`.
5. The entry is **abdicated** — it will not re-render on later state changes; a page reload (with the
   code fixed) is required. A deploy of the fixed file alone does not resurrect it in the same page
   unless HMR re-registers the entry.

This is why the rest of the homepage (cards, links, background, logo) kept working: the crash is
scoped to one entry, and `FooterRow` is the only registration that ever touched the bad symbol.

---

## 6. Recommended CSS / order recipe (copy-paste)

Goal: a new row in `conversation.input.dock` that sits **between the plugin's workspace deck and the
composer input bar**, optionally hidden outside the hero state.

### 6.1 Registration (DOM order)

Inside the existing guard, next to the other four registrations (plugin `lib/client.js:989-997`):

```js
ctx.slots.inject('conversation.input.dock', () => {
  const parts = [
    ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-workspaces', order: 10 }, WorkspaceRow),
    ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-widgets',    order: 11 }, WidgetsRow),
    ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-links',      order: 12 }, LinksRow),
    ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-home-row',   order: 13 }, HomeRow),   // NEW
    ctx.slots.register({ name: 'conversation.input.dock', id: 'dshh-footer',     order: 14 }, FooterRow),
  ]
  return () => { for (const dispose of parts) dispose() }
})
```

- `id` must be unique in that slot (list kind dedupes by `id`; first sorted entry wins, the rest are
  dropped — silently). Do **not** reuse an existing id.
- Keep `priority` unset (it sorts before `order` and would leapfrog every `.dshh-*` row).
- `order` here only fixes **DOM/tab order**; vertical placement is CSS (below).

### 6.2 CSS

```css
/* the new row: below every deck row (-5…-2) and above the composer bar (0) */
.dshh-home-row{order:-1;margin:0}

/* only-on-hero, CSS path (mirrors the existing .dshh-deck/.dshh-footer rule) */
html[data-dshh-hero-only] [class*="composerStack"]:not([class*="composerHero"]) .dshh-home-row{display:none!important}
```

Resulting hero-state vertical order (CSS `order`, ascending):

> **后期修订**：应需求把**组件行移到了「模式选择行」（`heroWorkspaceRow`，含 Agent 预设控件）之上**。
> 现行阶梯（`lib/client.js` 的 CSS）为 `-7` HeroShell → `-6` 工作区 deck → `-5` 组件 deck →
> `-4` links → `-3` `heroWorkspaceRow` → `0` 输入框；下表是当时（组件行在模式行之下）的快照，仅作历史参考。

| order | element | set by |
|---|---|---|
| −6 | `HeroShell` root | `[class*="composerStack"] > :first-child` (plugin:1019) |
| −5 | `.dshh-deck` (workspaces) | plugin:1020 |
| −4 | `.dshh-deck-links` | plugin:1021 |
| −3 | `.heroWorkspaceRow` | plugin:1022 |
| −2 | `.dshh-deck-widgets` | plugin:1023 |
| **−1** | **`.dshh-home-row` (new)** | **new rule** |
| 0 | `todo` dock, `queue` dock, `InputBar` (DOM order decides) | none |
| 999 | `.dshh-deck.dshh-below` | plugin:1024 |
| 1000 | `.dshh-footer` | plugin:1076 |

Rules of thumb:

- Negative `order` ⇒ above the composer bar; `0` ⇒ also above the bar but interleaved with built-in
  dock rows by DOM order; `>0` ⇒ below the bar (only the footer should do that).
- CSS `order` takes only integers; ties are broken by DOM order (i.e. by the slot `order`).
- `.composerStack` already supplies `gap:6px` — don't add margins; a row that is `display:none` (or
  returns `null`) contributes no gap.
- Target your own row with a **descendant** selector, or
  `[data-slot="conversation.input.dock"] > .dshh-home-row`; `[class*="composerStack"] > .dshh-home-row`
  will never match (§1/§3).

### 6.3 `onlyOnHero` — two mechanisms, pick one

1. **Render-time (recommended, what the plugin already does):** consume `useHomepage()` and
   ```js
   if (deckHidden(current, current.config)) return null   // plugin:677-682, semantics:
   // hide iff config.workspaces.onlyOnHero === true && a non-blank session exists
   ```
   Clean, no CSS coupling, and it also removes the element from tab order.
2. **CSS:** the rule in §6.2. It depends on two things being true, both currently are:
   `document.documentElement[data-dshh-hero-only]` is stamped only while
   `config.workspaces.onlyOnHero === true` (plugin:946-947, removed at :985 on dispose), and
   `composerStack` carries the extra `composerHero` class **only in the hero state**
   (conversation:17900).

Do not mix the two for the same row; CSS hiding is the fallback if the row cannot use the store.

---

## 7. Gotchas worth knowing before adding a row

1. **Tab order ≠ visual order.** CSS `order` re-sequences boxes only; keyboard focus follows DOM.
   The plugin already ships this mismatch (DOM: workspaces→widgets→links→footer; visual:
   workspaces→links→widgets→footer). A new row placed by CSS at −1 but registered at `order: 13`
   will be *visually* above the links but *tabbed* after them.
2. **`display:contents` accessibility caveat:** some browser/AT combinations drop the anchor
   semantics of a `display:contents` element. The `data-slot` div carries no role anyway, so no
   regression — just don't rely on it as a box.
3. **A crashed entry leaves a real (empty) div** in the flex flow: one extra `gap`, no other trace.
   Watch the console / Cordis panel, not the layout.
4. **Abdication is sticky.** After a crash the entry stays dead until re-registration or reload.
5. **Slot `order` is per-slot, not global:** values only compete inside `conversation.input.dock`.
6. **Do not register with a duplicate `id`** — you will silently lose one of the two entries
   (dedupe by id keeps the first in `(priority, order)` order).
7. `renderSlot` throws `SlotOwnershipError` for keys the declaring entry did not declare as children
   (`client.js:345-349`); the dock is declared by `conversation.content`, so only that subtree can
   render it.

---

## 8. Search log (including negative results)

| looked for | result |
|---|---|
| `composerStack` in shell bundle | 0 hits — composer lives in `dsh-client-ui-conversation` |
| `renderSlot` in shell bundle | 0 hits — implementation is `dsh-client-ui-renderer` |
| package dir named `*slots*` in asar | 0 files — core is a static module of the shell bundle |
| `ErrorBoundary` in shell bundle | 0 hits; only React's own `getDerivedStateFromError` machinery (1 hit at `index-BXV-oxvX.js:120`, inside React DOM) |
| `componentDidCatch` in shell bundle | 4 hits, all React internals |
| `onEntryError` across the whole asar (raw-offset scan + header map) | 16 hits: 13 in `dsh-client-ui-renderer`, 2 in `dsh-cordis-client-runner`, 1 in shell (core definition) |
| `slot entry crashed in` across asar | 2 (renderer only) |
| `reportEntryError` consumers | renderer host face + cordis client/host runners + `dsh-client-ui-cordis` UI |

Search commands used (reproducible):

```bash
grep -o ".\{120\}composerStack.\{120\}" <asar-extract>/dsh-client-ui-conversation/lib/client.js
grep -n "kind: \"list\"" <asar-extract>/dsh-client-ui-conversation/lib/client.js
grep -n "SlotErrorBoundary\|renderOutletContent\|ANCHOR_STYLE" <asar-extract>/dsh-client-ui-renderer/lib/client.js
grep -n "onEntryError\|reportRenderFailure" <asar-extract>/dsh-cordis-client-runner/lib/client.js
# raw-asar offset→file mapping was done with a small python script over the asar header
# (12/16-byte pickle) to prove which packages consume slot errors.
```
