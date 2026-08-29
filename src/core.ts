import { ZEN_LIMIT_RESEARCH } from "./research.js";
import type {
  AnalyzeUsageOptions,
  FreeUsageReport,
  ModelLimitOverride,
  ModelUsageReport,
  TokenUsage,
  UsageObservation,
  UsageStatus,
} from "./types.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export function utcDayStart(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export function nextUtcMidnight(input: Date): Date {
  return new Date(utcDayStart(input).getTime() + DAY_MS);
}

export function secondsUntilNextUtcMidnight(input: Date): number {
  return Math.max(0, Math.ceil((nextUtcMidnight(input).getTime() - input.getTime()) / 1000));
}

export function quotaStatus(remainingPercent: number, exhausted = false): UsageStatus {
  if (exhausted || remainingPercent <= 0) return "depleted";
  if (remainingPercent <= 5) return "terminal";
  if (remainingPercent <= 15) return "critical";
  if (remainingPercent <= 30) return "low";
  if (remainingPercent <= 60) return "draining";
  return "healthy";
}

export function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addTokens(target: TokenUsage, input?: Partial<TokenUsage>): void {
  if (!input) return;
  const inputTokens = finite(input.input);
  const output = finite(input.output);
  const reasoning = finite(input.reasoning);
  const cacheRead = finite(input.cacheRead);
  const cacheWrite = finite(input.cacheWrite);
  const suppliedTotal = finite(input.total);
  target.input += inputTokens;
  target.output += output;
  target.reasoning += reasoning;
  target.cacheRead += cacheRead;
  target.cacheWrite += cacheWrite;
  target.total += suppliedTotal || inputTokens + output + reasoning + cacheRead + cacheWrite;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateOf(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeLimit(value: number | ModelLimitOverride): ModelLimitOverride {
  if (typeof value === "number") return { dailyLimit: value, confidence: "medium" };
  return value;
}

function countsTowardQuota(observation: UsageObservation): boolean {
  if (typeof observation.counted === "boolean") return observation.counted;
  return observation.outcome !== "free-limit";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentRemaining(remaining: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.round(clamp((remaining / limit) * 100, 0, 100) * 10) / 10;
}

function computeRate(counted: Array<{ atMs: number }>, nowMs: number, dayStartMs: number) {
  if (!counted.length) return { perMinute: 0, perHour: 0, source: "insufficient-data" as const };
  const lastHourStart = Math.max(dayStartMs, nowMs - HOUR_MS);
  const lastHour = counted.filter((item) => item.atMs >= lastHourStart && item.atMs <= nowMs);
  const elapsedLastHourMs = Math.max(1, nowMs - lastHourStart);
  if (lastHour.length >= 2 && elapsedLastHourMs >= MINUTE_MS) {
    const perHour = lastHour.length / (elapsedLastHourMs / HOUR_MS);
    return {
      perMinute: round(perHour / 60, 3),
      perHour: round(perHour, 2),
      source: "last-hour" as const,
    };
  }
  const elapsedDayMs = Math.max(1, nowMs - dayStartMs);
  if (elapsedDayMs >= MINUTE_MS) {
    const perHour = counted.length / (elapsedDayMs / HOUR_MS);
    return {
      perMinute: round(perHour / 60, 3),
      perHour: round(perHour, 2),
      source: "day-average" as const,
    };
  }
  return { perMinute: 0, perHour: 0, source: "insufficient-data" as const };
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function observedResetFromLimitEvents(
  events: Array<{ atMs: number; retryAfterSeconds?: number }>,
  canonicalResetMs: number,
): { resetAt: string | null; deltaSeconds: number | null } {
  const event = [...events].reverse().find((item) => Number.isFinite(item.retryAfterSeconds));
  if (!event?.retryAfterSeconds) return { resetAt: null, deltaSeconds: null };
  const observed = event.atMs + event.retryAfterSeconds * 1000;
  return {
    resetAt: new Date(observed).toISOString(),
    deltaSeconds: Math.round((observed - canonicalResetMs) / 1000),
  };
}

/**
 * Analyze an observation stream against the best-known Zen free-tier limiter model.
 *
 * This is deliberately an estimator. The exact production values live in OpenCode's
 * private ZEN_LIMITS / ZEN_MODELS secrets, and server counters are keyed by public IP.
 */
export function analyzeZenFreeUsage(
  observations: UsageObservation[],
  options: AnalyzeUsageOptions = {},
): FreeUsageReport {
  const now = dateOf(options.now ?? new Date()) ?? new Date();
  const nowMs = now.getTime();
  const dayStart = utcDayStart(now);
  const resetAt = nextUtcMidnight(now);
  const dayStartMs = dayStart.getTime();
  const resetMs = resetAt.getTime();
  const baseline = positiveInt(options.baselineDailyLimit ?? ZEN_LIMIT_RESEARCH.baselineDailyRequests.value, 200);
  const ipState = options.ipState ?? "unknown";
  const coverage = options.coverage ?? "unknown";

  const effectiveLimit = ipState === "new" ? baseline * 2 : baseline;
  const limitRange =
    ipState === "unknown" ? { min: baseline, max: baseline * 2 } : { min: effectiveLimit, max: effectiveLimit };

  const normalized = observations
    .map((observation) => {
      const at = dateOf(observation.at);
      return at ? { observation, atMs: at.getTime() } : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .filter((item) => item.atMs >= dayStartMs && item.atMs < resetMs && item.atMs <= nowMs)
    .sort((a, b) => a.atMs - b.atMs);

  const counted = normalized.filter((item) => countsTowardQuota(item.observation));
  const limitEvents = normalized.filter((item) => item.observation.outcome === "free-limit");
  const tokens = emptyTokens();
  for (const item of counted) addTokens(tokens, item.observation.tokens);

  const usedObserved = counted.length;
  const remainingEstimate = Math.max(0, effectiveLimit - usedObserved);
  const remainingRange = {
    min: Math.max(0, limitRange.min - usedObserved),
    max: Math.max(0, limitRange.max - usedObserved),
  };
  const remainingPercent = percentRemaining(remainingEstimate, effectiveLimit);
  const rate = computeRate(counted, nowMs, dayStartMs);
  const secondsRemaining = Math.max(0, (resetMs - nowMs) / 1000);
  const projectedAdditional = rate.perHour * (secondsRemaining / 3600);
  const projectedUsedAtReset = Math.round((usedObserved + projectedAdditional) * 10) / 10;
  const projectedRemainingAtReset = Math.max(0, Math.round((effectiveLimit - projectedUsedAtReset) * 10) / 10);
  const hoursToExhaust = rate.perHour > 0 ? remainingEstimate / rate.perHour : Number.POSITIVE_INFINITY;
  const exhaustionMs = nowMs + hoursToExhaust * HOUR_MS;
  const estimatedExhaustionAt = Number.isFinite(exhaustionMs) && exhaustionMs < resetMs ? new Date(exhaustionMs).toISOString() : null;

  const byModel = new Map<string, Array<(typeof normalized)[number]>>();
  for (const item of normalized) {
    const model = item.observation.model || "unknown";
    const rows = byModel.get(model) ?? [];
    rows.push(item);
    byModel.set(model, rows);
  }

  const models: ModelUsageReport[] = [...byModel.entries()]
    .map(([model, rows]) => {
      const modelCounted = rows.filter((row) => countsTowardQuota(row.observation));
      const modelLimitEvent = rows.some((row) => row.observation.outcome === "free-limit");
      const modelTokens = emptyTokens();
      for (const row of modelCounted) addTokens(modelTokens, row.observation.tokens);
      const rawOverride = options.modelLimits?.[model];
      const override = rawOverride === undefined ? undefined : normalizeLimit(rawOverride);
      const modelLimit = override ? positiveInt(override.dailyLimit, 0) : null;
      const remaining = modelLimit === null ? null : Math.max(0, modelLimit - modelCounted.length);
      const pct = modelLimit === null || remaining === null ? null : percentRemaining(remaining, modelLimit);
      return {
        model,
        usedObserved: modelCounted.length,
        limitEstimate: modelLimit,
        remainingEstimate: modelLimitEvent ? 0 : remaining,
        remainingPercent: modelLimitEvent ? 0 : pct,
        status: modelLimitEvent ? "depleted" : pct === null ? "unknown" : quotaStatus(pct),
        exhaustedObserved: modelLimitEvent,
        bucket: override?.bucket ?? (override ? model.substring(0, 2) : null),
        confidence: override?.confidence ?? (modelLimitEvent ? "high" : "low"),
        tokens: modelTokens,
        lastObservationAt: rows.length ? new Date(rows[rows.length - 1]!.atMs).toISOString() : null,
      } satisfies ModelUsageReport;
    })
    .sort((a, b) => b.usedObserved - a.usedObserved || a.model.localeCompare(b.model));

  const observedReset = observedResetFromLimitEvents(
    limitEvents.map((item) => ({
      atMs: item.atMs,
      ...(item.observation.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: item.observation.retryAfterSeconds }
        : {}),
    })),
    resetMs,
  );

  const note =
    coverage === "complete"
      ? "Observed counts cover the caller-declared complete IP activity, but hidden production model overrides can still make the baseline reservoir differ by model/prefix bucket."
      : "Observed count is a lower bound for the server's IP counter. Other devices, processes, direct API calls, provider-error retries, and users behind the same public IP may consume quota without appearing here.";

  return {
    free: {
      usedObserved,
      baselineDailyLimit: baseline,
      effectiveDailyLimitEstimate: effectiveLimit,
      effectiveDailyLimitRange: limitRange,
      remainingEstimate,
      remainingRange,
      remainingPercent,
      status: quotaStatus(remainingPercent),
      exhaustionEventsObserved: limitEvents.length,
      anyModelExhaustedObserved: limitEvents.length > 0,
      ipState,
      newIpBonusPossible: ipState !== "established",
      tokens,
      models,
      window: {
        type: "calendar-day",
        timezone: "UTC",
        startedAt: dayStart.toISOString(),
        resetsAt: resetAt.toISOString(),
        secondsUntilReset: Math.max(0, Math.ceil(secondsRemaining)),
      },
      reset: {
        policy: "midnight-utc",
        confidence: "high",
        observedRetryAfterResetAt: observedReset.resetAt,
        observedRetryAfterDeltaSeconds: observedReset.deltaSeconds,
      },
      rate: {
        observedRequestsPerMinute: rate.perMinute,
        observedRequestsPerHour: rate.perHour,
        source: rate.source,
      },
      projection: {
        projectedUsedAtReset,
        projectedRemainingAtReset,
        estimatedExhaustionAt,
        willLikelyExhaustBeforeReset: estimatedExhaustionAt !== null,
      },
    },
    source: {
      mode: "observed-estimate",
      scope: "ip",
      coverage,
      accuracy: "estimate",
      observations: normalized.length,
      countedObservations: counted.length,
      limitEvents: limitEvents.length,
      note,
    },
  };
}

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
