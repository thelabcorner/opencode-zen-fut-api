import type { ZenModelCatalog, ZenModelCatalogEntry } from "./types.js";

export const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";

export const STATIC_FREE_MODEL_IDS = new Set([
  "big-pickle",
  "deepseek-v4-flash-free",
  "muse-spark-1.2-contributor-free",
  "mimo-v2.5-free",
  "hy3-free",
  "ling-3.0-flash-fin-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "laguna-s-2.1-free",
  // Listed in current docs even when absent from the live catalog snapshot.
  "x-preview-f-free",
]);

export function isFreeZenModel(model: string, additional?: Iterable<string>): boolean {
  if (!model) return false;
  if (model.endsWith("-free")) return true;
  if (STATIC_FREE_MODEL_IDS.has(model)) return true;
  if (additional) {
    for (const id of additional) if (id === model) return true;
  }
  return false;
}

interface CatalogResponse {
  data?: ZenModelCatalogEntry[];
}

export async function fetchZenModelCatalog(options: {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
} = {}): Promise<ZenModelCatalog> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) return fallbackCatalog(options.now?.() ?? new Date());
  const timeoutMs = options.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(ZEN_MODELS_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Zen model catalog returned HTTP ${response.status}`);
    const json = (await response.json()) as CatalogResponse;
    const all = Array.isArray(json.data) ? json.data.filter((item) => typeof item?.id === "string") : [];
    if (!all.length) throw new Error("Zen model catalog returned no models");
    return {
      fetchedAt: (options.now?.() ?? new Date()).toISOString(),
      source: "live",
      all,
      free: all.filter((model) => isFreeZenModel(model.id)),
    };
  } catch {
    return fallbackCatalog(options.now?.() ?? new Date());
  } finally {
    clearTimeout(timeout);
  }
}

export function fallbackCatalog(now = new Date()): ZenModelCatalog {
  const free = [...STATIC_FREE_MODEL_IDS].sort().map((id) => ({ id, object: "model", owned_by: "opencode" }));
  return {
    fetchedAt: now.toISOString(),
    source: "fallback",
    all: free,
    free,
  };
}
