import { isFreeZenModel } from "./models.js";
import type { UsageObservation } from "./types.js";
import type { ZenFreeUsageTracker } from "./tracker.js";

export interface ObservedZenFetchOptions {
  additionalFreeModelIds?: Iterable<string>;
  now?: () => Date;
  parseModel?: (input: RequestInfo | URL, init?: RequestInit) => string | undefined | Promise<string | undefined>;
}

export function createObservedZenFetch(
  tracker: Pick<ZenFreeUsageTracker, "observe">,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  options: ObservedZenFetchOptions = {},
): typeof globalThis.fetch {
  if (!fetchImpl) throw new Error("fetch implementation is required");

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const model = options.parseModel
      ? await options.parseModel(input, init)
      : await parseModelFromRequest(input, init);
    const response = await fetchImpl(input, init);
    if (!model || !isFreeZenModel(model, options.additionalFreeModelIds)) return response;

    const at = (options.now?.() ?? new Date()).toISOString();
    let observation: UsageObservation;
    if (response.ok) {
      observation = { at, model, outcome: "completed", counted: true, statusCode: response.status, source: "fetch" };
    } else {
      const body = await safeResponseText(response);
      const freeLimit = isFreeLimitBody(body);
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
      observation = {
        at,
        model,
        outcome: freeLimit ? "free-limit" : "provider-error",
        counted: !freeLimit,
        statusCode: response.status,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        source: "fetch",
      };
    }
    tracker.observe(observation);
    return response;
  }) as typeof globalThis.fetch;
}

async function parseModelFromRequest(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.includes("/zen/v1/")) return undefined;
  const body = init?.body;
  if (typeof body === "string") return parseModelJson(body);
  if (input instanceof Request) {
    const type = input.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      try { return parseModelJson(await input.clone().text()); } catch { return undefined; }
    }
  }
  return undefined;
}

function parseModelJson(body: string): string | undefined {
  try {
    const value = JSON.parse(body) as { model?: unknown };
    return typeof value.model === "string" ? value.model : undefined;
  } catch {
    return undefined;
  }
}

async function safeResponseText(response: Response): Promise<string> {
  try { return (await response.clone().text()).slice(0, 64_000); } catch { return ""; }
}

function isFreeLimitBody(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("freeusagelimiterror") || lower.includes("free usage exceeded") || lower.includes("free limit reached");
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.ceil(numeric));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
