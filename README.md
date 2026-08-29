# OpenCode Zen FUT API

An evidence-driven **Free Usage Tracker** for OpenCode Zen's free models.

Zen does not expose a public free-quota usage endpoint, and the exact production limits are intentionally kept in deployment secrets. This project reconstructs the limiter from OpenCode's public server code, community measurements, `Retry-After` behavior, and your local OpenCode database.

It works in three forms from one codebase:

1. **TypeScript module** for applications that can observe their own Zen requests.
2. **Local OpenCode tracker/API** that reads `opencode.db` without proxying inference.
3. **Cloudflare Worker** for the shared research/estimation API. It accepts observations but does not pretend it can remotely read an IP-scoped quota.

> [!IMPORTANT]
> The current best-supported general baseline is **200 requests per UTC day**, but that number is an estimate, not a published production constant. OpenCode can assign hidden model-specific overrides at runtime. The tracker reports confidence and uncertainty instead of turning community lore into fake precision.

## What we know

| Finding | Best current answer | Confidence |
| --- | --- | --- |
| General free quota | **~200 requests/day** | Medium |
| Reset | **00:00 UTC** | High |
| Primary scope | **Public IP** | High |
| Main quota unit | **Requests, not tokens** | High |
| New-IP behavior | **2x default daily allowance** while lifetime default-bucket usage is below `7 x dailyLimit` | High |
| Paid Zen balance bypasses free cap | **No** for anonymous/free models | High |
| Go subscription bypasses free cap | **No** for the Zen free-model path | High |
| Model-specific caps | **Supported, values hidden/dynamic** | High |
| Model-specific server bucket | **UTC date + first 2 model-ID characters** | High |
| Default-model server bucket | **One shared daily bucket per IP** | High |
| Client-header gate | **Currently disabled** | High |
| Public free-usage endpoint | **None found** | High |

The high-confidence rows above come directly from the current OpenCode server implementation. The 200/day value is the exception: the schema and algorithm are public, but `ZEN_LIMITS` is an SST deployment secret, so the numeric value is not in Git history.

## Why reports disagree so much

The community has reported everything from a handful of requests to 700+ requests/day. That does not require a mysterious token-weighted quota.

The current source gives us a much cleaner explanation:

- OpenCode has a **general daily limit** from the private `ZEN_LIMITS` secret.
- A fresh/default IP can temporarily receive **2x** that limit.
- Any model may have its own hidden `rateLimit` from the private `ZEN_MODELS` configuration.
- Overridden models are counted in a **two-character model-prefix bucket**, not necessarily a unique per-model bucket.
- Users behind the same IPv4 address share the counter. IPv6 is normalized to the first four hextets before the limiter is called.
- Free-model quota is checked before Zen account billing is resolved, so adding paid balance does not make the free route unlimited.
- Provider outages and provider-level throughput controls can produce additional 429/5xx behavior that is not the user's daily free counter.
- The free-model configuration can be changed server-side without a source release.

That combination is enough to make one user's "limit" look very different from another user's.

## Community evidence

The strongest empirical data points we found:

- Repeated May-August community reports cite an OpenCode FAQ value of **200 requests/day**.
- A July 27-August 7 instrumented DeepSeek V4 Flash dataset logged **3,606 calls** and observed daily boundaries around **450-766 calls/day**, mean ~605. Its `Retry-After` values pointed to the next UTC midnight. The raw measurements are useful, but the author's token/capacity explanation is not supported by the current daily limiter source, which increments a request counter rather than token usage.
- On August 12, many users reported a sharp reduction for `deepseek-v4-flash-free` and `mimo-v2.5-free`, while other free models still worked. This aligns with hidden model-specific overrides or provider incidents much better than a single universal 200 counter.
- GitHub issue #42977 captured affected and unaffected free models on the same client and measured `Retry-After` landing at **00:00 UTC**.
- Team users report exhausting the free pool together behind one public IP.

See [RESEARCH.md](./RESEARCH.md) for the evidence matrix and source links.

## Architecture

```text
                         OpenCode Zen
                             ^
                             | inference remains direct
                             |
                    +-------------------+
                    | your application  |
                    | or OpenCode       |
                    +-------------------+
                      |              |
          observed fetch calls     opencode.db
                      |              |
                      v              v
               +---------------------------+
               | Zen FUT estimator         |
               |---------------------------|
               | UTC window                |
               | request observations      |
               | model/prefix overrides    |
               | 200/day best estimate     |
               | new-IP 2x model           |
               | Retry-After calibration   |
               | burn/projection           |
               +---------------------------+
                   ^                    ^
                   |                    |
            TypeScript module       Local HTTP API
                                    GET /v1/usage

        Cloudflare Worker: stateless calculator + research/model metadata
        POST /v1/usage, GET /v1/limits
```

This project is **not an inference proxy**.

## Why the Worker cannot just query your remaining quota

Zen's free limiter is keyed by the request's public IP. A Cloudflare Worker calling Zen would be measured under the Worker's egress IP, not your IP. There is also no public `/zen/v1/usage` equivalent for the free reservoir.

So the hosted API is intentionally honest:

- `GET /v1/limits` returns the current research model and free model catalog.
- `POST /v1/usage` analyzes observations you provide.
- `GET /v1/usage` returns `409 local_observation_required`.
- `zen-fut serve` provides the useful automatic `GET /v1/usage` locally because it can read your `opencode.db`.

## Zero-config OpenCode tracking

OpenCode stores session data in SQLite. The tracker looks for the same data directory convention used by OpenCode and honors `OPENCODE_DB`.

```bash
npm install
npm run build
node dist/cli.js usage
```

Or after installing the package globally/linking it:

```bash
zen-fut usage
```

Example shape:

```json
{
  "dbPath": "~/.local/share/opencode/opencode.db",
  "report": {
    "free": {
      "usedObserved": 137,
      "baselineDailyLimit": 200,
      "effectiveDailyLimitEstimate": 200,
      "effectiveDailyLimitRange": { "min": 200, "max": 400 },
      "remainingEstimate": 63,
      "remainingRange": { "min": 63, "max": 263 },
      "remainingPercent": 31.5,
      "status": "draining",
      "ipState": "unknown",
      "newIpBonusPossible": true,
      "window": {
        "type": "calendar-day",
        "timezone": "UTC"
      }
    }
  },
  "diagnostics": {
    "lowerBound": true
  }
}
```

### Why it counts `step-finish`, not prompts

One human prompt can trigger many LLM calls as the agent uses tools and continues. OpenCode stores those generation steps as `step-finish` parts under the assistant message.

Zen's free limiter increments requests. Therefore **counting human messages would dramatically undercount usage**. The DB adapter counts completed `step-finish` parts for `providerID = "opencode"` and free Zen models.

The DB path is still a lower bound because it cannot see:

- another device sharing your public IP,
- another user behind the same NAT/CGNAT,
- direct Zen API calls outside this OpenCode database,
- some transient retry attempts that never become a completed step.

When the database contains a persisted `FreeUsageLimitError`, the tracker marks depletion but does **not** increment used requests because the server rejects that request before `track()`.

## Local HTTP API

```bash
zen-fut serve
```

Default bind:

```text
http://127.0.0.1:8788
```

Endpoints:

```text
GET  /health
GET  /v1/usage      automatic local opencode.db report
GET  /v1/limits     research snapshot + live Zen free-model catalog
POST /v1/usage      analyze supplied observations
```

The local server keeps a tiny 2-second DB snapshot cache. Model metadata is cached for 6 hours. No database daemon, queue, KV, D1, or cron is required.

## TypeScript module

### Pure estimator

```ts
import { analyzeZenFreeUsage } from "opencode-zen-fut-api";

const report = analyzeZenFreeUsage(
  [
    { at: new Date(), model: "big-pickle", outcome: "completed" },
    { at: new Date(), model: "big-pickle", outcome: "completed" },
  ],
  {
    ipState: "established",
    baselineDailyLimit: 200,
  },
);

console.log(report.free.remainingEstimate);
```

### Stateful tracker

```ts
import { createZenFreeUsageTracker } from "opencode-zen-fut-api";

const tracker = createZenFreeUsageTracker({
  baselineDailyLimit: 200,
  ipState: "unknown",
});

tracker.observe({
  at: Date.now(),
  model: "mimo-v2.5-free",
  outcome: "completed",
});

console.log(tracker.getUsage());
```

### Observe direct Zen fetch calls

```ts
import {
  createObservedZenFetch,
  createZenFreeUsageTracker,
} from "opencode-zen-fut-api";

const tracker = createZenFreeUsageTracker();
const zenFetch = createObservedZenFetch(tracker, fetch);

await zenFetch("https://opencode.ai/zen/v1/chat/completions", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.OPENCODE_ZEN_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "big-pickle",
    messages: [{ role: "user", content: "hello" }],
  }),
});

console.log(tracker.getUsage());
```

The wrapper does not alter the request destination. It only observes the response. Successful free-model calls count; `FreeUsageLimitError` does not. Error bodies are cloned only for non-2xx responses, so successful streaming responses are not buffered.

## Read `opencode.db` directly

Node-only API:

```ts
import { readOpenCodeDbUsage } from "opencode-zen-fut-api/node";

const snapshot = readOpenCodeDbUsage({
  ipState: "established",
});

console.log(snapshot.report.free.usedObserved);
console.log(snapshot.report.free.remainingEstimate);
```

Requires Node 22.5+ because it uses the built-in `node:sqlite` module. There are **zero runtime npm dependencies**.

## Model-specific overrides

OpenCode supports hidden per-model rate limits, but production values are not published. If you have a measured value, inject it without changing the tracker:

```ts
const report = analyzeZenFreeUsage(observations, {
  modelLimits: {
    "mimo-v2.5-free": {
      dailyLimit: 50,
      bucket: "mi",
      confidence: "medium",
      note: "locally measured on 2026-08-28",
    },
  },
});
```

This is deliberately configuration, not a hard-coded claim.

## Current free model discovery

The tracker reads:

```text
GET https://opencode.ai/zen/v1/models
```

and treats `*-free` IDs plus known exception `big-pickle` as free. A static fallback is included for offline/failure cases.

As of August 28, 2026, the live catalog includes free IDs such as:

```text
big-pickle
deepseek-v4-flash-free
muse-spark-1.2-contributor-free
mimo-v2.5-free
hy3-free
ling-3.0-flash-fin-free
nemotron-3-ultra-free
nemotron-3.5-lightning-free
laguna-s-2.1-free
```

The official docs and live catalog can briefly disagree during promotions, so the live endpoint wins when available.

## Cloudflare Worker

Deploy:

```bash
npm install
npm run deploy
```

Optional API auth:

```bash
npx wrangler secret put TRACKER_API_TOKEN
```

Query research/model metadata:

```bash
curl https://YOUR_WORKER/v1/limits \
  -H "X-Tracker-Token: $TRACKER_API_TOKEN"
```

Analyze observations:

```bash
curl -X POST https://YOUR_WORKER/v1/usage \
  -H "Content-Type: application/json" \
  -H "X-Tracker-Token: $TRACKER_API_TOKEN" \
  -d '{
    "observations": [
      {"at":"2026-08-28T18:00:00Z","model":"big-pickle","outcome":"completed"}
    ],
    "options": {"ipState":"established"}
  }'
```

The Worker needs **no D1, KV, Durable Object, queue, cron, or inference proxy**. The live model catalog is cached in-isolate for 6 hours.

## Accuracy model

The API intentionally distinguishes facts from estimates:

- **High confidence**: IP scope, UTC reset, new-IP multiplier logic, request-counter mechanism, hidden per-model override support, bucket construction, limiter-before-billing ordering.
- **Medium confidence**: the current general production value being 200/day.
- **Low/unknown until observed**: exact current rate limit for a specific promotional free model.

The response uses names such as `usedObserved`, `remainingEstimate`, `effectiveDailyLimitRange`, and `coverage` for this reason.

## A subtle server detail worth knowing

For models with an explicit server `rateLimit`, current OpenCode source builds the Redis interval as:

```ts
`${YYYYMMDD}${modelId.substring(0, 2)}`
```

So this is actually a **two-character model-prefix bucket**. If two overridden models start with the same two characters, they can share a counter. The limiter can still compare that shared count against different model-specific limits.

For models without a specific override, the interval is only `YYYYMMDD`, which means they share one default free bucket for the public IP.

## Development

```bash
npm install
npm run check
```

Checks include strict TypeScript, built-in `node:test` tests, and the production build.

## Non-goals

This project does not:

- rotate IPs or bypass rate limits,
- proxy Zen inference,
- claim unpublished constants are official,
- equate a human prompt with one Zen request,
- infer another device's/IP's usage from an API key,
- use token totals as the current main daily-quota unit.

## Status

The limiter is a moving target because OpenCode can change `ZEN_LIMITS` and `ZEN_MODELS` server-side. The architecture is designed for that: the mechanics are encoded, but uncertain numeric values remain injectable and evidence-labeled.
