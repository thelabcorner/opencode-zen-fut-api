import { analyzeZenFreeUsage } from "./core.js";
import { fetchZenModelCatalog } from "./models.js";
import { ZEN_LIMIT_RESEARCH } from "./research.js";
import type { AnalyzeUsageOptions, UsageObservation } from "./types.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new Error("content-type must be application/json");
  return request.json();
}

type UsageBody = {
  observations?: UsageObservation[];
  options?: AnalyzeUsageOptions;
};

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "opencode-zen-fut-api" });
  }

  if (request.method === "GET" && url.pathname === "/v1/limits") {
    const models = await fetchZenModelCatalog();
    return json({ research: ZEN_LIMIT_RESEARCH, models });
  }

  if (request.method === "GET" && url.pathname === "/v1/usage") {
    return json(
      {
        error: "local_observation_required",
        message:
          "Zen free usage is IP-scoped and no public server-side usage endpoint exists. POST observations here or run the local zen-fut server beside OpenCode.",
      },
      409,
    );
  }

  if (request.method === "POST" && url.pathname === "/v1/usage") {
    try {
      const body = (await readJson(request)) as UsageBody;
      if (!Array.isArray(body?.observations)) {
        return json({ error: "invalid_request", message: "observations must be an array" }, 400);
      }
      return json(analyzeZenFreeUsage(body.observations, body.options ?? {}));
    } catch (error) {
      return json(
        { error: "invalid_request", message: error instanceof Error ? error.message : "invalid JSON body" },
        400,
      );
    }
  }

  return json({ error: "not_found" }, 404);
}

export default {
  fetch: handle,
};
