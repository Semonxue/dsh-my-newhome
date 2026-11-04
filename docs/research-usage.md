# API usage research — what a homepage widget can actually show
> Sanitized: machine-specific paths, credential prefixes and session identifiers are abstracted; technical findings unchanged.

Researched 2026-11-04 (Asia/Shanghai) by a research subagent (research task).
All HTTP calls below were made from this machine with the real keys in
`$DSH_HOME/.credentials.yaml` (`refs:` map), parsed programmatically.
**No key value appears in this document** — keys are shown only as placeholders.
No key was written into any file under the plugin.

**Update 2026-11-04**: Cline Pass *does* have a usable remote quota route — the previously
"no endpoint known" verdict was wrong. Verified in §2.9 (`plan/usage-limits`), wired into the
plugin as the `cline-pass` adapter; token counts remain local-only.

Reproduce helpers: `<scratch>/keys.py` (loader + `req()` + `redact()`),
`<scratch>/agg2.mjs` (event-log aggregation), `<scratch>/projscan.mjs`
(projection-cache aggregation).

---

## 1. Verdict table

| Provider | What the widget can show | Endpoint | Auth | HTTP | Usable? |
|---|---|---|---|---|---|
| **deepseek** (`DEEPSEEK_API_KEY`) | CNY + USD cash balance, topped-up vs granted split | `GET https://api.deepseek.com/user/balance` | `Authorization: Bearer <key>` | 200 | ✅ **works** |
| deepseek | per-day tokens / spend history | — | — | 404 on `/user/usage`, `/usage`, `/dashboard/billing/usage` | ❌ **local fallback only** |
| **minimax-cn** (`MINIMAX_CN_API_KEY`, `sk-cp-` scheme) | coding-plan quota: 5 h window remaining %, weekly remaining %, reset countdown | `GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains` | `Authorization: Bearer <key>` (**no `GroupId`**) | 200 | ✅ **works** |
| minimax-cn | same payload on the newer/alt paths | `GET https://www.minimax.cn/v1/token_plan/remains`, `GET https://api.minimaxi.com/v1/token_plan/remains`, `GET https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains` | same | 200 | ✅ works (interchangeable) |
| minimax-cn | PAYG cash balance | `GET https://api.minimaxi.com/v1/account/balance` | same | **403** `token_type_mismatch` — *“api key is not an admin key”* | ⚠️ **needs an admin key** (not on this machine) |
| minimax-cn | billing history rows | `GET https://www.minimaxi.com/account/amount?page=1&limit=50&aggregate=false` | same | 200 | ⚠️ reachable + parses, but **empty of token usage** for a coding-plan account |
| minimax-cn | token-plan credit pool / console panel | `GET https://www.minimaxi.com/backend/account/token_plan_credit` | web-session **cookie** only | **401** `{"base_resp":{"status_code":1004,"status_msg":"not login"}}` | ❌ **local fallback only** |
| **cline-pass** (`CLINE_PASS_API_KEY`) | subscription windows: **used %** for 5 h / weekly / monthly + reset instants | `GET https://api.cline.bot/api/v1/users/me/plan/usage-limits` | `Authorization: Bearer <key>` (plain key; a WorkOS OAuth JWT needs the `workos:` **prefix**) | 200 | ✅ **works** |
| cline-pass | token / cost counts | — | — | `/users/me/usages` → 400 `Invalid request format`, `/users/me/plan/usage` → 404 | ❌ **local fallback only** |
| **tuzi** (`TUZI_API_KEY`) | nothing remote — no endpoint known | — | — | — | ❌ **local fallback only** |

Host/dialect gate for the MiniMax key: it is a **CN** key. `api.minimaxi.com` and
`api.minimax.chat` accept it; `api.minimax.io` (international) rejects it
(`401 {"error":{"message":"invalid api key (2049)"}}`). Always use the CN hosts.

**Normalized fields available per provider**

| provider | balance | used | limit | window | tokens |
|---|---|---|---|---|---|
| deepseek | `balance_infos[].total_balance` (CNY, USD), `topped_up_balance`, `granted_balance` | ❌ | ❌ | ❌ (cash, no window) | ❌ |
| minimax-cn (coding plan) | ❌ (`total_count` is 0 for `general`) | via `100 - remaining_percent` | ❌ (percent only) | 5 h fixed window + weekly window, both with epoch ms bounds and reset countdown | ❌ |
| minimax-cn (admin key only) | presumable, untested | — | — | — | — |
| cline-pass | ❌ | ✅ `percentUsed` per 5 h / weekly / monthly window | ❌ (percent only; internal entitlements cap in USD) | 5 h + weekly + monthly rolling windows, `resetsAt` ISO instants | ✅ **local DSH logs only** |
| tuzi | ❌ | ❌ | ❌ | ❌ | ✅ **only from local DSH logs** |
| any provider, per-day history | — | — | — | — | ✅ **only from local DSH logs** |

---

## 2. Verified response bodies (redacted)

### 2.1 DeepSeek balance — `GET https://api.deepseek.com/user/balance`

```http
GET /user/balance HTTP/1.1
Host: api.deepseek.com
Authorization: Bearer <DEEPSEEK_API_KEY>
Accept: application/json
```
`200`, `Content-Type: application/json`, 229 bytes:

```json
{
  "is_available": true,
  "balance_infos": [
    { "currency": "USD", "total_balance": "0.00", "granted_balance": "0.00", "topped_up_balance": "0.00" },
    { "currency": "CNY", "total_balance": "12.34", "granted_balance": "0.00", "topped_up_balance": "12.34" }
  ]
}
```

Notes:
- Two calls a few hours apart returned different values (the second slightly lower) — the number moves with real spend, so it is genuinely live.
- `USD` is present but `0.00`. Pick the **CNY** row first, then the first non-zero, then `balance_infos[0]`.
- All amounts are **strings**; parse with `Number()` and reject non-finite.
- 5 back-to-back calls: all `200`, no `X-RateLimit-*`, no `Retry-After`.

Auth failure for comparison (proves the endpoint is key-checked):
```http
401 {"error":{"message":"Authentication Fails, Your api key: ****-000 is invalid (request_id: …)","type":"authentication_error", …}}
```

### 2.2 MiniMax coding-plan quota — `GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains`

```http
GET /v1/api/openplatform/coding_plan/remains HTTP/1.1
Host: api.minimaxi.com
Authorization: Bearer <MINIMAX_CN_API_KEY>
```
**No `GroupId` parameter.** `200`, `application/json; charset=utf-8`, 992 bytes:

```json
{
  "model_remains": [
    {
      "start_time": 1793757600000,
      "end_time": 1793775600000,
      "remains_time": 8618997,
      "current_interval_total_count": 0,
      "current_interval_usage_count": 0,
      "model_name": "general",
      "current_weekly_total_count": 0,
      "current_weekly_usage_count": 0,
      "weekly_start_time": 1793548800000,
      "weekly_end_time": 1794153600000,
      "weekly_remains_time": 386618997,
      "current_interval_status": 1,
      "current_interval_remaining_percent": 27,
      "current_weekly_status": 3,
      "current_weekly_remaining_percent": 100
    },
    {
      "start_time": 1793721600000,
      "end_time": 1793808000000,
      "remains_time": 41018997,
      "current_interval_total_count": 3,
      "current_interval_usage_count": 3,
      "model_name": "video",
      "current_weekly_total_count": 21,
      "current_weekly_usage_count": 21,
      "weekly_start_time": 1793548800000,
      "weekly_end_time": 1794153600000,
      "weekly_remains_time": 386618997,
      "current_interval_status": 1,
      "current_interval_remaining_percent": 100,
      "current_weekly_status": 1,
      "current_weekly_remaining_percent": 100
    }
  ],
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

Field semantics (as used by the console and by third-party probes):
- `model_name: "general"` = text/coding quota; `"video"` = video quota. **The widget wants `general`.**
- `current_interval_remaining_percent` is the **remaining** percentage of the current **fixed** 5 h window
  (`end_time - start_time == 18 000 000 ms`). Used = `100 - remaining`.
- `current_interval_status`: `1` = active (window counting), `3` = unlimited/no limit.
- `current_weekly_status: 3` ⇒ weekly quota is **unlimited** — render `∞`, do **not** compute a percent ring
  (this is exactly the `dsh-cost-meter` rule: a missing window or a failed query must never be shown as unlimited).
- `remains_time` / `weekly_remains_time` are **milliseconds** until reset; `end_time` is the authoritative reset instant.
- 5 h windows are fixed clock periods (00:00–05:00, 05:00–10:00 CST…), **not** rolling from first request.
  Querying seconds before a boundary returns the next window's row.

`GroupId` behaviour (same host, real calls):

| request | result |
|---|---|
| no `GroupId` | `200` + quota (key implies the group) |
| `?GroupId=` (empty) | `200` + quota |
| `?GroupId=0` | `200` `{"base_resp":{"status_code":1004,"status_msg":"login fail: Please carry your GroupId in the 'GroupId' field of the request Params"}}` |
| `?GroupId=1999999999999999999` (wrong) | same `1004` login-fail payload |

⇒ **Do not send `GroupId` at all.** Sending one is the only way to break this working call.

### 2.3 MiniMax failure mode that will bite the widget

Bad or absent key returns **HTTP 200** with an error payload — HTTP status alone is not enough:

```json
200 {"base_resp": {"status_code": 1004, "status_msg": "cookie is missing, log in again"}}
```
Triggered by `Authorization: Bearer sk-cp-invalid` **and** by no `Authorization` header at all.
**Rule: validate `body.base_resp?.status_code === 0` before reading `model_remains`.**

### 2.4 MiniMax PAYG balance — blocked on key type

```http
GET https://api.minimaxi.com/v1/account/balance
Authorization: Bearer <MINIMAX_CN_API_KEY>
```
```json
403 {"error":{"type":"permission_error","code":"token_type_mismatch",
     "message":"api key is not an admin key","request_id":"<request-id>"}}
```
The route exists; the coding-plan key is the wrong *kind* of key. A MiniMax **admin key**
(console → account/team admin key, distinct from the `sk-cp-…` coding-plan key) is what this needs.
That key is **not** in `$DSH_HOME/.credentials.yaml`, so this metric is unavailable until someone adds one.
Probed alternates all `404`: `/v1/api/openplatform/account/balance`, `/v1/user/balance`,
`/v1/api/openplatform/billing/balance`, `/account/balance`, `/backend/account/balance`.

### 2.5 MiniMax billing history — reachable, but useless for this account

```http
GET https://www.minimaxi.com/account/amount?page=1&limit=50&aggregate=false
Authorization: Bearer <MINIMAX_CN_API_KEY>
```
`200` (and **also** on `api.minimaxi.com`), keys:
`charge_records, total_cnt, consume_cash_sum, consume_token_sum, consume_cash_after_voucher_sum, base_resp`.

```json
{
  "charge_records": [
    { "method": "code_plan_purchase", "consume_cash": "0.0000", "consume_token": "0",
      "created_at": 1793577600, "status": "SUCCESS", "model": "subscribe",
      "mail": "***(redacted)", "creator_id": "***(redacted)", "api_token_name": "***(redacted)",
      "group_id": "***(redacted)", "creator_name": "主账号",
      "ymd": "", "consume_time": "2026-11-02 08:00-09:00",
      "consume_cash_after_voucher": "0.0000" }
  ],
  "total_cnt": 5,
  "consume_cash_sum": "0.0000",
  "consume_token_sum": "0",
  "consume_cash_after_voucher_sum": "0.0000",
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

- No auth → `400 {"base_resp":{"status_code":1004,"status_msg":"not authorized"}}` (so the key **is** being honoured here).
- `total_cnt` = total rows for the account (5). `page=2&limit=5` → `charge_records: []`.
- Every row on this account is `code_plan_purchase` with `consume_token: "0"` — a coding-plan account
  consumes **subscription quota**, not cash-billed tokens, so there is nothing per-token to aggregate.
- `consume_token_sum` is documented elsewhere as unreliable (`"0"` even when rows exist); aggregate rows locally if ever used.
- ⚠️ rows carry `group_id`, `mail`, `creator_id`, `api_token_name` — **must be dropped before rendering**.

### 2.6 MiniMax cookie-only endpoint

```http
GET https://www.minimaxi.com/backend/account/token_plan_credit
401 {"base_resp":{"status_code":1004,"status_msg":"not login"}}
```
This is the "credit pool / weekly package" number the web console shows. It needs a logged-in
browser session (`_token` cookie), i.e. manual Cloudflare+CAPTCHA login — a hard no for a headless widget.

### 2.7 Auth sanity checks per host

| host + path | status | body |
|---|---|---|
| `POST https://api.minimaxi.com/v1/text/chatcompletion_v2` `{}` | 200 | `{"choices":null,"usage":null,"base_resp":{"status_code":2013,"status_msg":"invalid params, … missing required parameter"}}` → **auth passed** |
| `POST https://api.minimax.chat/v1/text/chatcompletion_v2` `{}` | 200 | same `2013` → key valid on the legacy CN domain too |
| `POST https://api.minimax.io/v1/text/chatcompletion_v2` `{}` | 200 | `{"base_resp":{"status_code":2049,"status_msg":"invalid api key"}}` |
| `GET https://api.minimax.io/v1/models` | 401 | `invalid api key (2049)` |
| `GET https://api.minimaxi.com/v1/models` | 200 | model list (`MiniMax-M3.1-Flash`, `MiniMax-M3`, `MiniMax-M2.7`, …) |
| `GET https://api.deepseek.com/models` | 200 | model list incl. `deepseek-flash`, `deepseek-v4-pro` |

### 2.8 Third-party claims checked against reality

| Claim (source) | Real result on this machine |
|---|---|
| "sk-cp- key as Bearer → `2062 no active token plan`; cookie is the only path" ([minimax-remaining-mcp](https://pypi.org/project/minimax-remaining-mcp/)) | **Contradicted.** `GET /v1/api/openplatform/coding_plan/remains` with the `sk-cp-` Bearer key returns `200` + live quota. Cookie-only applies to `/backend/account/token_plan_credit`, not to this route. |
| "Endpoint is `/v1/api/openplatform/coding_plan/remains?GroupId=…`" (same) | Endpoint is right, `GroupId` is **not** needed — sending it is what fails. |
| "Billing history is web-session-only, never an API-key path" ([CodexBar #1007](https://github.com/steipete/CodexBar/issues/1007)) | `GET /account/amount` **does** answer with the API key (200). The *shape* described there is exact; the auth claim is not. |
| "Probe `/v1/token_plan/remains` first, legacy `/v1/api/openplatform/coding_plan/remains` second; `current_weekly_status: 3` means ∞" ([dsh-cost-meter doc](https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/bc29c788710b5888877871f1bfeb1f030be495a8/docs/minimax-quota-endpoint.md)) | Confirmed — both paths return the identical payload; status `3` seen live on the weekly window. |

### 2.9 Cline Pass subscription windows — `GET https://api.cline.bot/api/v1/users/me/plan/usage-limits`

```http
GET /api/v1/users/me/plan/usage-limits HTTP/1.1
Host: api.cline.bot
Authorization: Bearer <CLINE_PASS_API_KEY>
Accept: application/json
```
`200`, `application/json`, live on 2026-11-04:

```json
{"data":{"limits":[
  {"type":"five_hour","percentUsed":22,"resetsAt":"2026-11-04T09:27:32.081780671Z"},
  {"type":"weekly",   "percentUsed":8, "resetsAt":"2026-11-11T04:27:32.084860831Z"},
  {"type":"monthly",  "percentUsed":80,"resetsAt":"2026-11-21T10:35:17.087565611Z"}
]},"success":true}
```

Measured behaviour:

| request shape | result |
|---|---|
| `Authorization: Bearer <CLINE_PASS_API_KEY>` (plain API key) | `200` + live windows ✅ |
| `Authorization: Bearer workos:<CLINE_PASS_API_KEY>` | `401` `{"error":"Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account."}` |
| `GET /api/v1/users/me` | `200` account profile |
| `GET /api/v1/users/me/plan` | `200` plan detail (`Cline Pass (Annual)`, `entitlements.cline_pass.inferenceCapThreshold` in USD per user; **no token counts**) |
| `GET /api/v1/users/me/usages` (and `?limit/cursor/startDate…`) | `400` `{"error":"Invalid request format"}` — not usable as-is |
| `POST /api/v1/users/me/usages` | `405` |
| `GET /api/v1/users/me/plan/usage` | `404` |

- `percentUsed` is the **used** share, 0–100 (integers in practice); three windows are all
  present in one response, so the widget needs exactly one call.
- `resetsAt` is an RFC 3339 instant with **nanosecond** digits (`…32.081780671Z`);
  `Date.parse` in Node/V8 truncates it to ms correctly.
- The plain key works with no `workos:` prefix — the prefix only applies to WorkOS **OAuth
  access tokens** (JWT shape `eyJ…`), which Cline's own desktop app sends that way. Try the
  plain header first and retry `workos:` only on 401/403 **and** a JWT-looking key.
- No token or cost number is exposed by this route; the local projection cache still supplies
  a token total for the tooltip.

---

## 3. Normalized widget payload contract (recommended)

One flat object per widget slot, already formatted for display so the client stays dumb.
Adapted from what `lib/index.js` builds today (`kind/primary/secondary/detail/tone`) — extended,
not replaced, so the existing client code keeps working with optional fields.

```ts
export type UsageKind = 'balance' | 'quota' | 'tokens'

export interface UsageWindow {
  kind: 'none' | 'fixed-5h' | 'weekly' | 'day'
  startAt?: number      // epoch ms, inclusive
  endAt?: number        // epoch ms, exclusive (authoritative reset instant)
  resetInMs?: number    // convenience countdown; recompute client-side from endAt
  unlimited?: boolean   // MiniMax status === 3 → render ∞, ignore value
}

export interface UsageMetric {
  /** stable slot id, e.g. "deepseek.balance" | "minimax.quota5h" | "minimax.week" | "local.tokens" */
  id: string
  provider: 'deepseek' | 'minimax' | 'cline-pass' | 'tuzi' | string   // DSH provider id
  label: string                 // "DeepSeek" / "MiniMax"
  kind: UsageKind

  value: number | null          // machine number: 12.34 | 27 | 13104690
  unit: 'CNY' | 'USD' | 'percent' | 'tokens'
  /** pre-formatted primary string, e.g. "¥12.34" | "27%" | "∞" | "13.1M" */
  primary: string
  /** short label under the value, e.g. "余额" | "5h 剩余" | "tokens · 本机累计" */
  secondary?: string
  /** one-line detail for hover/subtitle, e.g. "充值 ¥12.34 · 赠送 ¥0.00" */
  detail?: string

  tone: 'ok' | 'warn' | 'error' | 'neutral'
  window?: UsageWindow

  /** where the number came from — the UI must be allowed to say "本机统计" */
  source: 'remote' | 'local'
  fetchedAt: number             // epoch ms of the fetch/aggregation
  stale?: boolean               // served from TTL cache
  error?: { code: string; message: string; httpStatus?: number }

  /** optional secondary rows: weekly window, cache breakdown, per-model split */
  parts?: Array<{ key: string; label: string; value: number | null; unit: string; display: string }>
}

export interface UsageEnvelope {
  items: UsageMetric[]
  fetchedAt: number
  degraded?: boolean            // true when ≥1 provider fell back to local telemetry or errored
}
```

### Mapping rules (exact)

**DeepSeek → `kind: 'balance'`**
```
url    GET https://api.deepseek.com/user/balance
auth   Authorization: Bearer <DEEPSEEK_API_KEY>
pick   info = balance_infos.find(currency==='CNY') ?? balance_infos.find(currency==='USD') ?? balance_infos[0]
value  Number(info.total_balance)              // validate Number.isFinite
unit   info.currency
primary `¥12.34` / `$0.00`
secondary "余额"
detail `充值 ${topped_up_balance} · 赠送 ${granted_balance}`
tone   value <= 10 ? 'warn' : 'ok'
window { kind: 'none' }
error  non-200 → { code: body?.error?.type ?? 'http_' + status, message, httpStatus }
```

**MiniMax 5 h window → `kind: 'quota'`** (the primary MiniMax card)
```
url    GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains
auth   Authorization: Bearer <MINIMAX_CN_API_KEY>      // NO GroupId
guard  if (body.base_resp?.status_code !== 0) -> error { code: 'minimax_' + status_code,
                                                        message: base_resp.status_msg }   // HTTP is 200!
row    body.model_remains.find(r => r.model_name === 'general')
value  row.current_interval_remaining_percent          // REMAINING, not used
unit   'percent'
primary `${value}%`
secondary "5h 剩余"
detail  `已用 ${100 - value}% · ${hhmm(row.remains_time)} 后重置`
tone   value <= 20 ? 'error' : value <= 40 ? 'warn' : 'ok'
window { kind: 'fixed-5h', startAt: row.start_time, endAt: row.end_time, resetInMs: row.end_time - Date.now() }
```

**MiniMax weekly window → optional second card / `parts` entry**
```
value   row.current_weekly_remaining_percent
window  { kind: 'weekly', startAt: weekly_start_time, endAt: weekly_end_time,
          unlimited: row.current_weekly_status === 3 }
primary status === 3 ? '∞' : `${percent}%`
// unlimited ⇒ suppress "used %" rendering and any per-1% estimate
```

**Cline Pass windows → `kind: 'quota'`**
```
url    GET https://api.cline.bot/api/v1/users/me/plan/usage-limits
auth   Authorization: Bearer <CLINE_PASS_API_KEY>
retry  on 401/403 AND key matches /^ey[A-Za-z0-9_-]+\./ (OAuth JWT) → Bearer workos:<key>
rows   data.limits[] = { type: 'five_hour'|'weekly'|'monthly', percentUsed, resetsAt }
value  MAX(percentUsed) over the three windows
unit   'percent'
primary `${max}%`
secondary `${windowLabel}已用`          // "本月已用" | "本周已用" | "5 小时已用"
detail  other windows as `${label} ${pct}%` joined by ' · '
tone   max >= 80 ? 'warn' : 'ok'
breakdown  per window `${label} ${pct}% · ${countdown}后重置` + local token note
```

**Local telemetry → `kind: 'tokens'`** (see §4)
```
value   tokens for the window (today / 7 d / all time)
primary compactTokens(value)      // 13.1M
secondary "tokens · 本机累计"
detail  `${sessions} 个会话 · 入 ${in} / 出 ${out} · 缓存读 ${cacheRead}`
source  'local'
```

### Caching / TTL
- 60 s TTL per provider is safe: 5 back-to-back DeepSeek calls and 3 MiniMax calls showed no
  `429`, no `Retry-After`, no rate-limit headers. Treat the endpoint as best-effort: on failure
  keep the last good `UsageMetric` and set `stale: true` + `error`, never blank the card.
- Both calls are server-side only. The browser must only see the normalized payload — never a key
  and never `group_id` / `mail` / `creator_id` / `api_token_name`.

---

## 4. Local-telemetry fallback (the only source for some providers)

### 4.1 Which providers are fallback-only
- **cline-pass**: remote subscription windows ✅, but any *token* number is **local only**.
- **tuzi**: no remote usage/balance endpoint exists that we know of → **local only**.
- **minimax-cn**: remote quota ✅, but any *token/consumption* number is **local only**.
- **deepseek**: remote balance ✅, but *usage history per day* is **local only**.
- Also local-only: per-model split, per-day trend, cache-hit accounting for every provider.

### 4.2 Session log layout (real, this machine)
```
$DSH_HOME/sessions/
  <cwd-slug>/                                  # e.g. "--Users-<user>-<workspace>--"
    <session-uuid>/                            # dirs are either "session-<uuid>" or bare "<uuid>"
      session.v4.jsonl.zstd                    # current format — 318 files
      session.v3.jsonl.zstd                    # 80 files
      session.jsonl.zstd                       # v0 legacy — 134 files
      session.lock                             # 0-byte live-session lock, ignore
```
Totals measured on a representative local corpus: **several hundred MB**, ~500 `.zstd` files
(v4 majority, plus v3 and v0 legacies).

### 4.3 The zstd trap (important, cost two debugging rounds)
The files are **concatenated independent Zstandard frames** — one header frame plus one frame per
append batch (per `@deepseek-ai/dsh-session-persistence-jsonl` README §“Physical encoding”).
Node's built-in decoder decodes **only the first frame**:

```
file bytes 540039, frame magic 0x28B52FFD occurrences 267
zstdDecompressSync(file)      -> 205 bytes, 2 lines        ❌ (header frame only)
createZstdDecompress stream   -> 205 bytes, 1 line         ❌
per-frame decode (split on magic) -> 2 190 639 bytes, 539 lines, seq 0..537, 0 bad JSON  ✅
```
Recipe (Node ≥ 22.15, no native deps — verified on Node 22.23.1 where
`zlib.zstdDecompressSync` exists; `zstd -dc` CLI also works but is not guaranteed on user machines):

```js
const MAGIC = [0x28, 0xB5, 0x2F, 0xFD]
function decodeFrames(buf) {
  const starts = []
  for (let i = 0; i + 3 < buf.length; i++)
    if (buf[i] === 0x28 && buf[i+1] === 0xB5 && buf[i+2] === 0x2F && buf[i+3] === 0xFD) starts.push(i)
  let out = ''
  for (let i = 0; i < starts.length; i++) {
    try { out += zstdDecompressSync(buf.subarray(starts[i], starts[i+1] ?? buf.length)).toString('utf8') }
    catch { /* torn tail frame of a live session — stop, keep the complete prefix */ }
  }
  return out
}
```
A torn trailing frame on a session being written right now decodes to partial output and **must be
dropped**, not treated as corruption.

### 4.4 Event fields that carry provider/model and usage (quoted from a real v4 sample)
Header line:
```json
{"type":"session","version":4,"id":"session-<uuid>","createdAt":<epoch-ms>,
 "cwd":"<workspace-path>","isSeeded":false,"delegationDepth":0,"agentPreset":"standard"}
```
Every following line is `{ "type", "seq", "time", "data" }` (`time` = epoch **ms**; some rows also
carry `surfaceOp`, `sourceEventSeqs`).

| event `type` | fields used | example |
|---|---|---|
| `model/selection` | `data.provider`, `data.model` | `{"provider":"cline-pass","model":"cline-pass/deepseek-v4.1-flash-1017"}` |
| `request/context` | `data.provider`, `data.model`, `data.contextWindow` | `{"provider":"cline-pass","model":"…","contextWindow":262144}` |
| `request/header` | `data.header.config.provider`, `.model` | `{"header":{"config":{"provider":"cline-pass","model":"…"}}}` |
| **`assistant/message`** | `data.usage.{inputTokens,outputTokens,totalTokens,cacheReadTokens}` (+`cacheWriteTokens` when present), `data.turn`, `data.step` | `{"inputTokens":20765,"outputTokens":394,"totalTokens":21461,"cacheReadTokens":302}` |
| `step/start` / `step/end` | `data.turn`, `data.step` | `{"turn":1,"step":1}` |

- `inputTokens` **excludes** cache reads; `totalTokens = inputTokens + cacheReadTokens + outputTokens`.
  Do **not** add cache reads into "input" — see the 30× skew in §4.7.
- Usage is attached to `assistant/message`; `assistant/attempt` (`data.usage` too) exists for retries
  and `llm/retry-started` closes a replacement slot (`dsh-token-meter` folds them that way).
  **Summing `assistant/message` usage only = one charge per step, no retry double-count.**
  Verified: ~30 k `assistant/message` rows over the corpus, `assistant/attempt` only 18 in one sampled session.
- Model→provider mapping is fully recoverable: attribute each `assistant/message` to the **nearest
  preceding** `model/selection` (or `request/context`) in the same file. In a 12-session sample,
  934/935 messages had usage and **0** appeared before any selection event.

### 4.5 Providers actually seen in the logs (all sessions, `session.v4` only)
| `provider` value in `model/selection` | share of selection rows (rounded) |
|---|---|
| `cline-pass` | ≈76 % |
| `minimax-cn` | ≈22 % |
| `deepseek-account` | ≈1 % |
| `spawn` (subagent pseudo-provider) | <1 % |
| `deepseek-official` | <1 % |
| `tuzi` | <1 % |
| `session-title-first-prompt-llm` (internal) | <1 % |

So the fallback covers every provider the widget will ever list, including `tuzi`, and it is the
**only** source that does.

### 4.6 Two implementations — pick by need

**(A) Projection cache — fastest, coarse.** `$DSH_HOME/storages/session_projcache/sessions/<sessionId>.json`,
~500 files / a few MB, one versioned record per session:
```json
{"version":…,"record":{"identity":{…},"rows":{
  "modelSelection":{"ver":2,"seq":687,"val":{"lastUsed":{"provider":"deepseek-account","model":"deepseek-flash","reasoningEffort":"high"},"pending":null}},
  "tokenUsage":{"ver":2,"seq":687,"val":{"totals":{"uncachedInputTokens":200632,"outputTokens":65819,
                 "cacheReadTokens":9451776,"cacheWriteTokens":0},"last":{…}}},
  "timeContext":{"ver":2,"seq":687,"val":{"lastMessageTime":1793119059846,…}},
  "sessionStats":{…} }}}
```
Measured full scan: **~0.2 s**, ~500 files, no decompression.
Providers seen: mostly `cline-pass` sessions, then `minimax-cn`, with small counts for the
`deepseek-*` variants.
⚠️ (a) totals are **per-session cumulative**, so any "per day" number bucketed by `lastMessageTime`
attributes a whole session to one day — wrong for a "today" card.
⚠️ (b) `cacheReadTokens` is included in the "input" total by most naive folds and dominates it.
⚠️ (c) `totals` is a fold of the same `assistant/message` usage — it will not distinguish models
within a session except via `modelSelection.val.lastUsed` (last one wins).

**(B) Event logs — accurate per day/model, ~40× slower.** Full corpus (a few hundred v4 files,
several hundred MB compressed, ~200 k events, ~30 k usage messages, a ~6-week window):
**~9 s** single-threaded in Node with the frame-split decoder. Real output:

```json
{ "2026-11-04": {
    "cline-pass": { "messages": 170, "input": 1370424, "output": 130652, "cacheRead": 14774552, "cacheWrite": 0 },
    "minimax-cn": { "messages": 81,  "input": 469500,  "output": 142340, "cacheRead": 6424221,  "cacheWrite": 0 } } }
```
⇒ cache once with a 60 s TTL **and** make it incremental: remember `(path, mtimeMs, size)` per file
and only re-decode files whose mtime changed (an append rewrites nothing; only the tail file moves).
Steady state is then a handful of files, not 318.

**(C) Sanctioned seam, if the composition exposes it.** `ctx.sessionQuery`
(`@deepseek-ai/dsh-session-query`, SQLite backend `dsh-session-query-sqlite` is present in this build):
`listSessions()` → `readSession(id)` / `filterEvents(id, { types: ['assistant/message'], timeRange })`
returns replay-validated events without touching zstd, format generations, or crash recovery.
Prefer this when available (`typeof ctx.sessionQuery?.filterEvents === 'function'`); fall back to
(A)/(B) otherwise. The plugin has no compile-time dependency either way — this stays a duck-typed call.

### 4.7 Why the numbers differ (do not mix the two sources)
Same corpus, two folds (magnitudes rounded):

| provider | proj-cache "input" (incl. cache read) | event-log `inputTokens` (fresh) | event-log `outputTokens` |
|---|---|---|---|
| cline-pass | ≈3.3 B | ≈109 M | ≈21 M |
| minimax-cn | ≈1.7 B | ≈29 M | ≈4.4 M |
| deepseek-official | ≈1.2 B | ≈0.75 M | ≈0.19 M |
| deepseek-account | ≈0.23 B | ≈2.1 M | ≈1.4 M |

The 30× gap is `cacheReadTokens`. A "billions of tokens" card is technically true and completely useless.
**Recommendation:** primary = `uncachedInputTokens + cacheWriteTokens + outputTokens`
("billed tokens"), and show cache reads as a separate `parts` entry.

### 4.8 What the current `lib/index.js` already does (observed, not modified)
- `deepseekBalance()` → matches reality; CNY-first pick is correct (USD is `0.00`).
- `minimaxQuota()` currently `return null` — it can now return the 5 h card from §2.2.
- `scanLocalUsage()` reads the projection cache (`PROJ_CACHE_DIR`) — the measured ~0.2 s is accurate; it folds
  `uncachedInputTokens + cacheReadTokens + cacheWriteTokens` into `input`, which produces the 30×
  inflated total in §4.7. Either rename that line to a "含缓存" label or split it.
- The scan has no per-day dimension and no incremental cache; if a "today" card is wanted, §4.6(B) is required.

---

## 5. Failure modes & operational notes

| Case | Observed behaviour | Required handling |
|---|---|---|
| MiniMax bad/missing key | **HTTP 200** `{"base_resp":{"status_code":1004,"status_msg":"cookie is missing, log in again"}}` | check `base_resp.status_code`, map to error card |
| MiniMax sent `GroupId` (any value, even `0`) | `200` + `1004 login fail: Please carry your GroupId…` | never send `GroupId` |
| MiniMax international host (`api.minimax.io`) | `401 invalid api key (2049)` | pin CN host: `api.minimaxi.com` (or `www.minimax.cn`) |
| MiniMax PAYG balance with `sk-cp-` key | `403 token_type_mismatch` “not an admin key” | don't call it; needs an admin key |
| MiniMax cookie endpoints | `401` `1004 not login` | out of scope; never attempt |
| DeepSeek bad key | `401` `authentication_error` | error card, keep last good value |
| DeepSeek 404 for usage paths | `404 <empty>` | confirmed no usage endpoint |
| Network/timeout | not observed; 5–12 s timeouts used | 8 s timeout, TTL cache, never block the hero render |
| Rate limits | none observed (5 DeepSeek, 3 MiniMax sequential calls, no `X-RateLimit-*`) | still TTL 60 s; do not poll faster |
| Live session file being appended | torn final zstd frame | drop the failing frame, keep the decoded prefix |
| Projection cache file half-written | `JSON.parse` throw | `try/catch` per file, skip it |

### Secrets hygiene
- Resolve keys through `ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))` when the
  composition exposes the credentials service; today `lib/index.js` already falls back to parsing
  `.credentials.yaml` and `process.env`. Both are acceptable; neither may reach the browser.
- Billing rows (§2.5) contain `group_id`, `mail`, `creator_id`, `api_token_name` — strip them before
  the payload leaves the host process; they are not part of the contract in §3.
