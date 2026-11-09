import { afterEach, describe, expect, it, vi } from "vitest";
import { fetch, type HeadersInit } from "undici";
import { discoverGatewayModels } from "../gateway-model-catalog.js";

const signal = () => new AbortController().signal;
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status }) as never;
const env = {
  ANTHROPIC_BASE_URL: "https://gateway.example/anthropic/",
  ANTHROPIC_AUTH_TOKEN: "synthetic",
};

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(fetch).mockReset();
  vi.mocked(fetch).mockRejectedValue(new Error("Network disabled in tests"));
});

describe("gateway model discovery", () => {
  it("authenticates every page, retains exact IDs and rereads changed catalogs", async () => {
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      const url = new URL(String(input));
      const headers = new Headers(options?.headers as HeadersInit);
      if (
        url.pathname !== "/anthropic/v1/models" ||
        headers.get("authorization") !== "Bearer synthetic" ||
        options?.redirect !== "error"
      ) {
        return reply({}, 401);
      }
      return url.searchParams.get("after_id") === "auto/First"
        ? reply({ data: [{ id: "grok/Second", display_name: "Second" }], has_more: false })
        : reply({ data: [{ id: "auto/First" }], has_more: true, last_id: "auto/First" });
    });
    const first = await discoverGatewayModels(env, signal());
    expect(
      first.status === "ready" &&
        first.models.map((m) => [m.value, m.displayName, m.supportsEffort]),
    ).toEqual([
      ["auto/First", "auto/First", undefined],
      ["grok/Second", "Second", undefined],
    ]);
    vi.mocked(fetch).mockResolvedValue(reply({ data: [{ id: "devin/replacement" }] }));
    const next = await discoverGatewayModels(env, signal());
    expect(next.status === "ready" && next.models.map((m) => m.value)).toEqual([
      "devin/replacement",
    ]);
  });

  it("preserves declared SDK effort levels without requiring a Claude model name", async () => {
    vi.mocked(fetch).mockResolvedValue(
      reply({
        data: [
          {
            id: "vendor/reasoner",
            supported_reasoning_levels: [
              { effort: "low" },
              { effort: "ultra" },
              { effort: "high" },
              { effort: "low" },
              { effort: "xhigh" },
              { effort: "max" },
            ],
          },
          { id: "unknown" },
          { id: "unsupported", supported_reasoning_levels: [{ effort: "minimal" }] },
          { id: "malformed", supported_reasoning_levels: "invalid" },
        ],
      }),
    );
    const result = await discoverGatewayModels(env, signal());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected a catalog");
    expect(
      result.models.map(({ value, supportsEffort, supportedEffortLevels }) => ({
        value,
        supportsEffort,
        supportedEffortLevels,
      })),
    ).toEqual([
      {
        value: "vendor/reasoner",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high", "xhigh", "max"],
      },
      { value: "unknown", supportsEffort: undefined, supportedEffortLevels: undefined },
      { value: "unsupported", supportsEffort: false, supportedEffortLevels: [] },
      { value: "malformed", supportsEffort: undefined, supportedEffortLevels: undefined },
    ]);
  });

  it("applies explicit effort overrides only to exact catalog IDs", async () => {
    vi.mocked(fetch).mockResolvedValue(
      reply({
        data: [
          { id: "vendor/reasoner", supported_reasoning_levels: [{ effort: "low" }] },
          { id: "manual" },
          { id: "manual-alias" },
        ],
      }),
    );
    const result = await discoverGatewayModels(
      {
        ...env,
        CLAUDE_ACP_MODEL_EFFORTS: JSON.stringify({
          "vendor/reasoner": [],
          manual: ["high", "medium"],
          removed: ["max"],
        }),
      },
      signal(),
    );
    expect(
      result.status === "ready" && result.models.map((m) => [m.value, m.supportedEffortLevels]),
    ).toEqual([
      ["vendor/reasoner", []],
      ["manual", ["high", "medium"]],
      ["manual-alias", undefined],
    ]);
  });

  it.each(["not-json", '{"model":["ultra"]}', '{"model":"high"}'])(
    "rejects invalid explicit overrides without echoing their values",
    async (override) => {
      await expect(
        discoverGatewayModels({ ...env, CLAUDE_ACP_MODEL_EFFORTS: override }, signal()),
      ).rejects.toThrow(
        "Invalid CLAUDE_ACP_MODEL_EFFORTS: expected model IDs mapped to SDK effort arrays",
      );
    },
  );

  it("uses API-key auth and preserves an existing v1 path", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const headers = new Headers(options?.headers as HeadersInit);
      return String(url) === "https://other.example/v1/models" &&
        headers.get("x-api-key") === "key" &&
        headers.get("x-tenant") === "tenant"
        ? reply({ data: [{ id: "codex/gpt-test" }] })
        : reply({}, 401);
    });
    const result = await discoverGatewayModels(
      {
        ANTHROPIC_BASE_URL: "https://other.example/v1",
        ANTHROPIC_API_KEY: "key",
        ANTHROPIC_CUSTOM_HEADERS: "x-tenant: tenant",
      },
      signal(),
    );
    expect(result.status === "ready" && result.models[0].value).toBe("codex/gpt-test");
  });

  it.each([
    { data: [{ id: "bad id" }] },
    { data: [{ id: "ok" }], has_more: true },
    { error: "synthetic-secret-must-not-leak" },
  ])("rejects invalid/incomplete catalogs without exposing response data", async (body) => {
    vi.mocked(fetch).mockResolvedValue(reply(body));
    const result = await discoverGatewayModels(env, signal());
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it("distinguishes empty success from failure and retries after failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply({}, 401))
      .mockResolvedValueOnce(reply({ data: [] }));
    expect(await discoverGatewayModels(env, signal())).toEqual({
      status: "unavailable",
      reason: "http-401",
    });
    expect(await discoverGatewayModels(env, signal())).toEqual({ status: "ready", models: [] });
  });

  it("bounds a stalled request without caching the timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const pending = discoverGatewayModels(env, signal());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ status: "unavailable", reason: "timeout" });
    vi.mocked(fetch).mockResolvedValue(reply({ data: [{ id: "healthy" }] }));
    expect((await discoverGatewayModels(env, signal())).status).toBe("ready");
  });

  it("propagates caller cancellation instead of returning a fallback", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller-cancelled"));
    await expect(discoverGatewayModels(env, controller.signal)).rejects.toThrow("caller-cancelled");
  });

  it.each([
    {},
    { ANTHROPIC_BASE_URL: "https://api.anthropic.com", CLAUDE_ACP_MODEL_EFFORTS: "invalid" },
    { ...env, CLAUDE_CODE_USE_VERTEX: "1" },
    { ...env, CLAUDE_ACP_MODEL_DISCOVERY: "off" },
  ])("leaves native/disabled discovery alone", async (input) => {
    expect(await discoverGatewayModels(input, signal())).toEqual({ status: "disabled" });
  });

  it("rejects oversized payloads and repeated pagination cursors", async () => {
    vi.mocked(fetch).mockResolvedValue(reply({ data: [], padding: "x".repeat(2 * 1024 * 1024) }));
    expect(await discoverGatewayModels(env, signal())).toEqual({
      status: "unavailable",
      reason: "catalog-too-large",
    });
    vi.mocked(fetch).mockImplementation(async () =>
      reply({ data: [{ id: "one" }], has_more: true, last_id: "one" }),
    );
    expect(await discoverGatewayModels(env, signal())).toEqual({
      status: "unavailable",
      reason: "invalid-pagination",
    });
  });
});
