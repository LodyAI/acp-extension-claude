import { readFile } from "node:fs/promises";
import { getCACertificates } from "node:tls";
import { EnvHttpProxyAgent, fetch } from "undici";
import { z } from "zod";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";

const entrySchema = z.object({
  id: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[^\s\p{Cc}]+$/u),
  display_name: z.string().max(512).optional(),
});
const pageSchema = z.object({
  data: z.array(entrySchema).max(4096),
  has_more: z.boolean().optional(),
  last_id: z.string().min(1).max(512).optional(),
});

export type GatewayCatalog =
  | { status: "disabled" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; models: ModelInfo[] };

/** A fresh snapshot per session. Never cache failures, credentials, or gateway catalogs. */
export async function discoverGatewayModels(
  env: Record<string, string | undefined>,
  signal: AbortSignal,
): Promise<GatewayCatalog> {
  const base = env.ANTHROPIC_BASE_URL;
  if (
    !base ||
    env.CLAUDE_ACP_MODEL_DISCOVERY === "off" ||
    ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"].some(
      (key) => env[key] === "1" || env[key] === "true",
    )
  )
    return { status: "disabled" };

  let dispatcher: EnvHttpProxyAgent | undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  const bounded = AbortSignal.any([signal, controller.signal]);
  try {
    signal.throwIfAborted();
    const url = new URL(base);
    if (url.hostname === "api.anthropic.com") return { status: "disabled" };
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return { status: "unavailable", reason: "invalid-endpoint" };
    }
    url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/v1$/, "")}/v1/models`;
    const headers = new Headers({ "anthropic-version": "2023-06-01" });
    for (const line of (env.ANTHROPIC_CUSTOM_HEADERS ?? "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const colon = line.indexOf(":");
      if (colon < 1) return { status: "unavailable", reason: "invalid-headers" };
      headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    // Never forward a subscription OAuth token to a custom endpoint.
    if (env.ANTHROPIC_AUTH_TOKEN) {
      headers.set("authorization", `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`);
      headers.delete("x-api-key");
    } else if (env.ANTHROPIC_API_KEY) {
      headers.set("x-api-key", env.ANTHROPIC_API_KEY);
    }
    const tls = {
      ...(env.NODE_EXTRA_CA_CERTS
        ? {
            ca: [...getCACertificates("default"), await readFile(env.NODE_EXTRA_CA_CERTS, "utf8")],
          }
        : {}),
      ...(env.CLAUDE_CODE_CLIENT_CERT ? { cert: await readFile(env.CLAUDE_CODE_CLIENT_CERT) } : {}),
      ...(env.CLAUDE_CODE_CLIENT_KEY ? { key: await readFile(env.CLAUDE_CODE_CLIENT_KEY) } : {}),
      ...(env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE
        ? { passphrase: env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE }
        : {}),
    };
    const proxy = env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || "";
    dispatcher = new EnvHttpProxyAgent({
      // Explicit empty values prevent fallback to another session's process env.
      httpProxy: proxy,
      httpsProxy: proxy,
      noProxy: [env.no_proxy, env.NO_PROXY].filter(Boolean).join(",").replace(/\s+/g, ","),
      connect: tls,
      requestTls: tls,
      proxyTls: tls,
    });
    const models = new Map<string, ModelInfo>();
    const cursors = new Set<string>();
    let bytes = 0;
    for (let pageNumber = 0; pageNumber < 32; pageNumber++) {
      bounded.throwIfAborted();
      const response = await fetch(url, {
        headers,
        dispatcher,
        redirect: "error",
        signal: bounded,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return { status: "unavailable", reason: `http-${response.status}` };
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          bounded.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024)
            return { status: "unavailable", reason: "catalog-too-large" };
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const page = pageSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      for (const entry of page.data) {
        models.set(entry.id, {
          value: entry.id,
          displayName: entry.display_name || entry.id,
          description: "",
          // A directory entry does not prove Claude SDK feature compatibility.
          supportsEffort: false,
          supportsFastMode: false,
          supportsAutoMode: false,
          supportsAdaptiveThinking: false,
        });
      }
      if (models.size > 4096) return { status: "unavailable", reason: "catalog-too-large" };
      if (!page.has_more) return { status: "ready", models: [...models.values()] };
      if (!page.last_id || cursors.has(page.last_id)) {
        return { status: "unavailable", reason: "invalid-pagination" };
      }
      cursors.add(page.last_id);
      url.searchParams.set("after_id", page.last_id);
    }
    return { status: "unavailable", reason: "too-many-pages" };
  } catch {
    signal.throwIfAborted();
    // Do not expose upstream bodies, URLs, headers or proxy credentials in logs.
    return {
      status: "unavailable",
      reason: controller.signal.aborted ? "timeout" : "request-failed",
    };
  } finally {
    clearTimeout(timeout);
    await dispatcher?.destroy();
  }
}
