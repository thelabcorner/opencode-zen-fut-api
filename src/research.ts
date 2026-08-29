import type { Confidence } from "./types.js";

export interface ResearchFinding<T> {
  value: T;
  confidence: Confidence;
  basis: string[];
}

export const RESEARCH_AS_OF = "2026-08-28";

export const ZEN_LIMIT_RESEARCH = {
  asOf: RESEARCH_AS_OF,
  baselineDailyRequests: {
    value: 200,
    confidence: "medium",
    basis: [
      "Repeated community reports quote OpenCode's earlier Go/Free FAQ as 200 requests/day.",
      "Multiple June-August 2026 users independently describe the normal free reservoir as 200 requests/day.",
      "The numeric production value is not present in the public repository because ZEN_LIMITS is an SST secret, so 200 cannot be source-verified today.",
    ],
  } satisfies ResearchFinding<number>,
  reset: {
    value: "00:00 UTC",
    confidence: "high",
    basis: [
      "Current OpenCode server code computes Retry-After as seconds until the next UTC day boundary.",
      "Community measurements of FreeUsageLimitError Retry-After align with 00:00 UTC.",
    ],
  } satisfies ResearchFinding<string>,
  quotaUnit: {
    value: "requests",
    confidence: "high",
    basis: [
      "The current free limiter increments a Redis integer once per tracked request and does not use token counts in the daily check.",
      "Token usage is used separately for trial-provider eligibility, not the main daily free-request limiter.",
    ],
  } satisfies ResearchFinding<string>,
  scope: {
    value: "public IP",
    confidence: "high",
    basis: [
      "Current server code builds the anonymous/free daily key from x-real-ip.",
      "IPv6 addresses are normalized to their first four hextets before the limiter is called.",
      "Team and VPN reports consistently show quota sharing/changing with public IP.",
    ],
  } satisfies ResearchFinding<string>,
  newIpAllowance: {
    value: "2x the default daily limit while lifetime default-bucket usage is below 7x the default limit",
    confidence: "high",
    basis: [
      "Current ipRateLimiter marks a default-bucket IP new while lifetimeCount < dailyLimit * 7 and permits dailyLimit * 2.",
      "The lifetime counter is only used for default models without a model-specific rateLimit override.",
    ],
  } satisfies ResearchFinding<string>,
  modelOverrides: {
    value: "supported and dynamically configured; exact values unpublished",
    confidence: "high",
    basis: [
      "Zen model configuration has an optional integer rateLimit field.",
      "Model configuration is stored in deployment secrets rather than the public repository.",
      "August 2026 reports show some free models exhausting while other free models remain usable from the same client/IP.",
    ],
  } satisfies ResearchFinding<string>,
  overriddenBucketKey: {
    value: "UTC date + first two characters of model ID",
    confidence: "high",
    basis: [
      "Current ipRateLimiter constructs the daily interval for overridden models from YYYYMMDD + modelId.substring(0, 2).",
      "Therefore this is technically a prefix bucket, not necessarily a unique per-model counter.",
    ],
  } satisfies ResearchFinding<string>,
  defaultBucketKey: {
    value: "one shared UTC-date bucket per public IP",
    confidence: "high",
    basis: [
      "Models without an explicit rateLimit use the date-only daily key, so they share the default counter.",
    ],
  } satisfies ResearchFinding<string>,
  paidBalanceBypass: {
    value: false,
    confidence: "high",
    basis: [
      "For allowAnonymous free models, the IP limiter check runs before authentication/billing resolution in the current Zen handler.",
      "Users with Zen balance and Go subscriptions report the same free-model IP quota.",
    ],
  } satisfies ResearchFinding<boolean>,
  clientHeaderGate: {
    value: "currently disabled",
    confidence: "high",
    basis: [
      "The current ipRateLimiter hard-codes headersExist = true and comments out the prior client-header validation.",
      "OpenCode commit history includes 'zen: remove header check' on April 5, 2026.",
    ],
  } satisfies ResearchFinding<string>,
  apiAvailability: {
    value: "no public free-usage counter endpoint found",
    confidence: "high",
    basis: [
      "Zen exposes /zen/v1/models, but no equivalent of the Go usage endpoint for anonymous/free quota was found.",
      "The quota lives in server-side Redis keyed by client IP and is not returned as X-RateLimit-Remaining headers.",
    ],
  } satisfies ResearchFinding<string>,
  communityRange: {
    value: "highly variable: ~200 typical baseline reports, 450-766/day measured during an earlier DeepSeek promotion, and severe model-specific tightening/outages in August 2026",
    confidence: "medium",
    basis: [
      "The variability is consistent with hidden model rateLimit overrides, changing promotion policy, new-IP allowance, shared-IP usage, and provider incidents.",
      "Current source does not support the popular theory that the main daily free quota is token-weighted.",
    ],
  } satisfies ResearchFinding<string>,
} as const;

export const RESEARCH_SOURCES = [
  {
    kind: "source-code",
    label: "Current OpenCode free IP limiter",
    url: "https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/util/ipRateLimiter.ts",
  },
  {
    kind: "source-code",
    label: "ZEN_LIMITS schema",
    url: "https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/subscription.ts",
  },
  {
    kind: "source-code",
    label: "Zen model schema / hidden rateLimit",
    url: "https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/model.ts",
  },
  {
    kind: "source-code",
    label: "Zen request handler and limiter ordering",
    url: "https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/util/handler.ts",
  },
  {
    kind: "source-code",
    label: "OpenCode local session schema",
    url: "https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts",
  },
  {
    kind: "official",
    label: "OpenCode Zen docs",
    url: "https://opencode.ai/docs/zen/",
  },
  {
    kind: "official",
    label: "Live Zen model catalog",
    url: "https://opencode.ai/zen/v1/models",
  },
  {
    kind: "community",
    label: "Reddit: Free limit ends too fast now? (Aug 12, 2026)",
    url: "https://www.reddit.com/r/opencode/comments/1vm9bhh/free_limit_ends_too_fast_now/",
  },
  {
    kind: "community",
    label: "Reddit: OpenCode usage for free models (Aug 15, 2026)",
    url: "https://www.reddit.com/r/opencode/comments/1vpekgn/opencode_usage_for_free_models/",
  },
  {
    kind: "community",
    label: "GitHub #42977: model-specific FreeUsageLimitError behavior",
    url: "https://github.com/anomalyco/opencode/issues/42977",
  },
  {
    kind: "community",
    label: "GitHub #42765: request for exposed free quota headers",
    url: "https://github.com/anomalyco/opencode/issues/42765",
  },
  {
    kind: "community",
    label: "GitHub #33318: paid Zen balance still hits free limiter",
    url: "https://github.com/anomalyco/opencode/issues/33318",
  },
] as const;
