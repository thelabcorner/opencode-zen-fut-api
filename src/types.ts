export type Confidence = "high" | "medium" | "low";
export type IpState = "new" | "established" | "unknown";
export type ObservationOutcome = "completed" | "provider-error" | "free-limit";
export type UsageStatus = "healthy" | "draining" | "low" | "critical" | "terminal" | "depleted";
export type ModelUsageStatus = UsageStatus | "unknown";

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageObservation {
  at: string | number | Date;
  model: string;
  providerID?: string;
  outcome?: ObservationOutcome;
  /**
   * Whether this observation consumed a Zen free-request counter slot.
   * Defaults to false for free-limit errors and true otherwise.
   */
  counted?: boolean;
  statusCode?: number;
  retryAfterSeconds?: number;
  tokens?: Partial<TokenUsage>;
  source?: "opencode-db" | "manual" | "fetch" | (string & {});
}

export interface ModelLimitOverride {
  dailyLimit: number;
  /** Optional server bucket label. If omitted, the model is reported independently. */
  bucket?: string;
  confidence?: Confidence;
  note?: string;
}

export interface AnalyzeUsageOptions {
  now?: string | number | Date;
  /** Best-known general free quota. Current community-backed default is 200/day. */
  baselineDailyLimit?: number;
  ipState?: IpState;
  /** Known or experimentally inferred model-specific overrides. */
  modelLimits?: Record<string, number | ModelLimitOverride>;
  /** Whether the observation stream covers all clients sharing the public IP. */
  coverage?: "complete" | "local-only" | "unknown";
}

export interface ModelUsageReport {
  model: string;
  usedObserved: number;
  limitEstimate: number | null;
  remainingEstimate: number | null;
  remainingPercent: number | null;
  status: ModelUsageStatus;
  exhaustedObserved: boolean;
  bucket: string | null;
  confidence: Confidence;
  tokens: TokenUsage;
  lastObservationAt: string | null;
}

export interface FreeUsageReport {
  free: {
    usedObserved: number;
    baselineDailyLimit: number;
    effectiveDailyLimitEstimate: number;
    effectiveDailyLimitRange: { min: number; max: number };
    remainingEstimate: number;
    remainingRange: { min: number; max: number };
    remainingPercent: number;
    status: UsageStatus;
    exhaustionEventsObserved: number;
    anyModelExhaustedObserved: boolean;
    ipState: IpState;
    newIpBonusPossible: boolean;
    tokens: TokenUsage;
    models: ModelUsageReport[];
    window: {
      type: "calendar-day";
      timezone: "UTC";
      startedAt: string;
      resetsAt: string;
      secondsUntilReset: number;
    };
    reset: {
      policy: "midnight-utc";
      confidence: "high";
      observedRetryAfterResetAt: string | null;
      observedRetryAfterDeltaSeconds: number | null;
    };
    rate: {
      observedRequestsPerMinute: number;
      observedRequestsPerHour: number;
      source: "last-hour" | "day-average" | "insufficient-data";
    };
    projection: {
      projectedUsedAtReset: number;
      projectedRemainingAtReset: number;
      estimatedExhaustionAt: string | null;
      willLikelyExhaustBeforeReset: boolean;
    };
  };
  source: {
    mode: "observed-estimate";
    scope: "ip";
    coverage: "complete" | "local-only" | "unknown";
    accuracy: "estimate";
    observations: number;
    countedObservations: number;
    limitEvents: number;
    note: string;
  };
}

export interface ZenModelCatalogEntry {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface ZenModelCatalog {
  fetchedAt: string;
  source: "live" | "fallback";
  all: ZenModelCatalogEntry[];
  free: ZenModelCatalogEntry[];
}

export interface OpenCodeDbReadOptions extends AnalyzeUsageOptions {
  dbPath?: string;
  /** Additional IDs to classify as free even if they do not end in -free. */
  freeModelIds?: Iterable<string>;
  providerIDs?: Iterable<string>;
}

export interface OpenCodeDbSnapshot {
  dbPath: string;
  observations: UsageObservation[];
  report: FreeUsageReport;
  diagnostics: {
    stepFinishRows: number;
    providerErrorRows: number;
    freeLimitRows: number;
    ignoredRows: number;
    lowerBound: boolean;
    note: string;
  };
}
