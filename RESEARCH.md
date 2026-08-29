# OpenCode Zen Free Usage Limits: Research Ledger

**Research date:** 2026-08-28  
**Target:** OpenCode Zen free models at `https://opencode.ai/zen/v1`  
**Goal:** reconstruct the free-tier limiter accurately enough to power a usage API without inventing unpublished values.

## Executive conclusion

The best current model is:

```text
General/default free bucket:
  scope: public IP
  window: UTC calendar day
  best-estimate baseline: ~200 tracked requests/day
  fresh-IP allowance: 2x baseline
  fresh condition: lifetime default-bucket count < 7x baseline

Optional model override:
  configured privately per model
  quota value: unpublished and changeable
  bucket key: UTC date + first 2 characters of model ID
  fresh-IP 2x logic: does not apply

Reset:
  exactly next 00:00 UTC in current source
```

The **algorithm** is high-confidence because it is public source code. The **200** numeric baseline is only medium-confidence because production values are stored in the private `ZEN_LIMITS` secret.

## 1. Source-code reconstruction

### 1.1 Current free IP limiter

Source:

- https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/util/ipRateLimiter.ts

The current implementation:

1. Loads `Subscription.getFreeLimits()`.
2. Chooses `rateLimit ?? limits.dailyRequests`.
3. Uses `x-real-ip` as the quota identity.
4. Builds a UTC date bucket.
5. For a model-specific override, appends `modelId.substring(0, 2)` to the date.
6. For a default model, also reads a lifetime IP counter.
7. Marks an IP `isNew` while `lifetimeCount < dailyLimit * 7`.
8. Lets a new IP consume `dailyLimit * 2` in the default bucket.
9. Throws `FreeUsageLimitError` when the counter is exhausted.
10. Sets `Retry-After` to seconds until the next UTC day boundary.
11. Increments the daily counter in `track()`.

This establishes the core mechanics independently of any forum estimate.

### 1.2 The numeric baseline is deliberately outside the repository

Sources:

- https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/subscription.ts
- https://github.com/anomalyco/opencode/blob/dev/infra/console.ts
- https://github.com/anomalyco/opencode/blob/dev/packages/console/core/script/update-limits.ts

`Subscription` defines:

```ts
free: {
  promoTokens: number
  dailyRequests: number
  dailyRequestsFallback: number
  checkHeaders: Record<string, string>
}
```

but reads the actual values from `Resource.ZEN_LIMITS.value`. Infrastructure defines `ZEN_LIMITS` as an SST secret, and the maintenance script edits that secret directly.

**Implication:** anyone claiming an exact current number from the public source tree alone is overclaiming. The value can also change without a normal code commit.

### 1.3 Model-specific values are also private

Source:

- https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/model.ts

Each model can carry:

```ts
rateLimit?: number
allowAnonymous?: boolean
```

The model configuration is assembled from private `ZEN_MODELS1` through `ZEN_MODELS30` secret fragments.

This explains why one free model can be blocked while another remains usable on the same IP.

### 1.4 Prefix buckets, not strictly per-model buckets

Current source uses:

```ts
rateLimit
  ? `${buildYYYYMMDD(now)}${modelId.substring(0, 2)}`
  : buildYYYYMMDD(now)
```

That means an overridden model's counter is grouped by its **first two ID characters**.

Examples:

```text
deepseek-v4-flash-free       -> de
mimo-v2.5-free               -> mi
nemotron-3-ultra-free        -> ne
nemotron-3.5-lightning-free  -> ne
```

If both Nemotron models have overrides, they can share the `ne` counter. This is a source-backed mechanism that can create surprising cross-model exhaustion behavior.

### 1.5 IP normalization

Source:

- https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/util/handler.ts

The handler reads `x-real-ip`. IPv4 remains intact. IPv6 is reduced to the first four colon-separated hextets before it reaches the limiter.

So the effective identity is roughly:

```text
IPv4: exact public address
IPv6: first 64-ish bits / first four textual hextets
```

This makes ordinary IPv6 privacy-address rotation less likely to create a fresh quota identity.

### 1.6 Free limiter runs before billing/auth resolution

The same handler chooses the IP limiter for `allowAnonymous` models and executes `rateLimiter.check()` before `authenticate(...)` and billing-source selection.

This matches community reports from users who had:

- Zen balance,
- a Zen API key,
- a Go subscription,

and still exhausted the free-model pool.

Paid credits do not convert the anonymous free route into an unlimited paid route.

### 1.7 Main free quota is request-count based

The current IP limiter increments an integer by one per tracked request. The daily check does not examine input, output, cached, or reasoning tokens.

There is a separate trial-provider token accumulator, plus provider-level TPM/TPS routing controls, but those are not the main `FreeUsageLimitError` daily reservoir.

**Important correction to community interpretation:** token volume may correlate with session behavior, provider load, or number of agent turns, but current source does not support a token-weighted daily free-quota formula.

### 1.8 Current client-header theory is stale

Current `ipRateLimiter.ts` contains the old header-validation code commented out and sets:

```ts
const headersExist = true
```

Commit history also contains `zen: remove header check` dated 2026-04-05.

Therefore sending or omitting `x-opencode-*` headers is not the current primary explanation for free quota differences.

## 2. Historical limiter behavior

Historical source:

- https://github.com/anomalyco/opencode/blob/2a2082233d9e8bda4674ce596f04b61b3b32522d/packages/console/app/src/routes/zen/util/rateLimiter.ts

An earlier implementation supported either:

- a daily period, or
- an hourly configuration that summed the current and previous two hourly buckets.

That older architecture helps explain old community claims about multi-hour windows. It should **not** be projected onto the current August 2026 implementation, whose free IP limiter is now daily.

## 3. Reset time

### Source proof

Current function:

```ts
Math.ceil((86_400_000 - (now % 86_400_000)) / 1000)
```

This is seconds until the next Unix UTC-day boundary.

### Community proof

GitHub issue #42977 measured a `Retry-After` of roughly 19.4 hours at 04:32 UTC, landing on the next 00:00 UTC.

An independent local benchmark over late July/early August reported all daily limit `Retry-After` values pointing to UTC midnight.

**Verdict:** reset at **00:00 UTC**, confidence **high**.

## 4. The 200 requests/day baseline

### Evidence for 200

- May 2026 Reddit discussions repeatedly answer "200" when asked for Zen free request count.
- June reports explicitly describe being "stuck with 200RPD" even after adding Zen balance.
- August 12 Reddit users quote an OpenCode FAQ description: "Free models include Big Pickle plus promotional models available at the time, with a quota of 200 requests/day."

### Why confidence is not high

The current OpenCode codebase does not embed `200`. It loads `dailyRequests` from a secret. OpenCode can change it without publishing the value.

**Verdict:** use **200/day as the default estimator**, confidence **medium**, and make it overridable.

## 5. The 450-766 request/day dataset

Source:

- https://blog.chuanxilu.net/en/posts/2026/08/opencode-zen-go-misconceptions/

The author analyzed 3,606 local `deepseek-v4-flash-free` calls from 2026-07-27 through 2026-08-07 and reported:

- observed exhaustion boundaries around **450-766 requests/day**,
- mean around **605/day**,
- 49-72M tokens/day,
- `Retry-After` landing on next 00:00 UTC,
- one dense period with ~250 calls in the final hour.

The data itself is valuable and strongly supports the UTC reset.

The causal claim that the free daily quota varies with token consumption/resources is weaker. Current server source shows a request counter, not a token-weighted daily counter. More source-consistent explanations include:

- DeepSeek had a private model override different from the 200 default,
- the override changed during the observation period,
- some failures were provider/capacity throttles rather than the user's daily free counter,
- new/default-bucket allowance applied to some traffic,
- local instrumentation and the server counter did not cover exactly the same events.

## 6. August 12+ tightening

Sources:

- https://www.reddit.com/r/opencode/comments/1vm9bhh/free_limit_ends_too_fast_now/
- https://github.com/anomalyco/opencode/issues/42074
- https://github.com/anomalyco/opencode/issues/42385
- https://github.com/anomalyco/opencode/issues/42977
- https://github.com/anomalyco/opencode/issues/43786

Starting around August 12, multiple users reported much more aggressive `FreeUsageLimitError` behavior for DeepSeek V4 Flash Free and MiMo-V2.5 Free.

Key observation: some reports show other free models continuing to return 200 from the **same client/IP** while DeepSeek/MiMo returned 429.

That is strong evidence against a single universal account-wide counter being the whole story. It fits the source's private `rateLimit` override mechanism.

Because the exact production `ZEN_MODELS` values are private, this research does **not** assign made-up numeric caps such as "5/day" to those models. The API accepts measured overrides when available.

## 7. Shared-IP evidence

Sources:

- https://www.reddit.com/r/opencode/comments/1uff6fj/opencode_zen_hitting_freeusagelimit_easily/
- https://github.com/anomalyco/opencode/issues/33318

A team user reported three developers behind the same IP consuming the free limit roughly three times faster than one developer.

Other users report quota behavior changing when moving to a different network/public IP.

Current source directly confirms IP keying, so these reports are corroborative rather than the sole basis for the conclusion.

## 8. Why a remote quota API cannot be exact

A normal remote service cannot query the caller's current Redis counter because:

1. The counter is keyed by the **inference request's public IP**.
2. A Worker/server probe reaches Zen from the server's egress IP, not the user's IP.
3. OpenCode does not expose the free Redis count through a public usage endpoint.
4. Current rate-limit responses provide `Retry-After`, but not `X-RateLimit-Remaining` or the current count.

This is why `opencode-zen-fut-api` uses local observations rather than pretending an API key reveals the quota.

## 9. Local OpenCode data as a request counter

Current storage sources:

- https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts
- https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/v1/session.ts
- https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts

OpenCode stores session messages and parts in SQLite. A single assistant message can contain multiple `step-finish` parts. Each step finish records the tokens/cost for an LLM generation step.

For a coding agent this distinction is critical:

```text
1 human prompt
  -> model call
  -> tool call
  -> model continuation
  -> tool call
  -> model continuation

= 1 prompt, but ~3 inference requests
```

Therefore the local tracker counts free-model `step-finish` rows, not user prompts or assistant-message count.

### Remaining blind spots

`opencode.db` still cannot see:

- calls from another device sharing the public IP,
- direct HTTP calls outside OpenCode,
- every transient network/provider retry,
- another household/team user behind NAT/CGNAT.

So DB-derived usage is correctly labeled a **lower bound / estimate** unless the caller explicitly declares complete coverage.

## 10. Current free model catalog

Official live endpoint:

- https://opencode.ai/zen/v1/models

Observed on 2026-08-28:

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

Official docs can briefly lag or lead the model endpoint during promotions, so the implementation fetches the live catalog and uses a fallback heuristic for `*-free` plus `big-pickle`.

## 11. Confidence matrix

| Mechanism | Confidence | Reason |
| --- | --- | --- |
| UTC midnight reset | High | Current code + measured Retry-After |
| IP-scoped default quota | High | Current code + community reproduction |
| IPv6 prefix normalization | High | Current handler code |
| Request-count daily unit | High | Current Redis increment logic |
| Fresh IP 2x allowance | High | Current code |
| Fresh threshold `dailyLimit * 7` | High | Current code |
| Hidden per-model `rateLimit` | High | Current model schema + secret config |
| Prefix bucket `modelId[0:2]` | High | Current limiter code |
| Paid balance does not bypass | High | Limiter ordering + reports |
| Client header check disabled | High | Current code + commit history |
| Baseline = 200/day | Medium | Strong repeated community evidence, private prod value |
| Exact current DS/MiMo cap | Low/unknown | Production model secret, rapidly changing behavior |
| Token-weighted daily quota | Rejected for current limiter | Contradicted by current free limiter code |
| Fixed 5-hour free window | Rejected for current limiter | Current free IP limiter is UTC daily; older code differed |

## 12. API design consequences

The implementation follows five rules:

1. Encode source-verified **mechanics** as logic.
2. Keep unpublished **numeric values** configurable.
3. Use `200` only as a clearly labeled best estimate.
4. Prefer local generation-step observations over human prompt counts.
5. Never let a remote Worker claim it can see the caller's IP quota.

That makes the tracker useful today without baking August 2026 promotional policy into the architecture forever.
