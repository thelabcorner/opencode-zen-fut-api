import { analyzeZenFreeUsage, utcDayStart } from "./core.js";
import type { AnalyzeUsageOptions, FreeUsageReport, UsageObservation } from "./types.js";

export interface ZenFreeUsageTrackerOptions extends AnalyzeUsageOptions {
  maxObservations?: number;
}

export class ZenFreeUsageTracker {
  private observations: UsageObservation[] = [];
  private readonly options: ZenFreeUsageTrackerOptions;

  constructor(options: ZenFreeUsageTrackerOptions = {}) {
    this.options = { ...options };
  }

  observe(observation: UsageObservation): void {
    this.observations.push(observation);
    this.prune();
  }

  observeMany(observations: Iterable<UsageObservation>): void {
    for (const observation of observations) this.observations.push(observation);
    this.prune();
  }

  getUsage(options: AnalyzeUsageOptions = {}): FreeUsageReport {
    return analyzeZenFreeUsage(this.observations, { ...this.options, ...options });
  }

  snapshot(): UsageObservation[] {
    return [...this.observations];
  }

  clear(): void {
    this.observations = [];
  }

  replace(observations: Iterable<UsageObservation>): void {
    this.observations = [...observations];
    this.prune();
  }

  private prune(): void {
    const nowValue = this.options.now ?? new Date();
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
    const cutoff = utcDayStart(Number.isFinite(now.getTime()) ? now : new Date()).getTime() - 86_400_000;
    this.observations = this.observations.filter((observation) => {
      const at = observation.at instanceof Date ? observation.at : new Date(observation.at);
      return Number.isFinite(at.getTime()) && at.getTime() >= cutoff;
    });
    const max = this.options.maxObservations ?? 20_000;
    if (this.observations.length > max) this.observations.splice(0, this.observations.length - max);
  }
}

export function createZenFreeUsageTracker(options: ZenFreeUsageTrackerOptions = {}): ZenFreeUsageTracker {
  return new ZenFreeUsageTracker(options);
}
