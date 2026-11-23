import { readFile } from "node:fs/promises";
import { getCACertificates } from "node:tls";
import { EnvHttpProxyAgent } from "undici";

/**
 * An undici dispatcher for requests the adapter sends itself, configured from
 * `env` the way the Claude CLI configures its own: `HTTPS_PROXY`/`HTTP_PROXY`
 * (either case), `NO_PROXY`, `NODE_EXTRA_CA_CERTS` and the
 * `CLAUDE_CODE_CLIENT_*` mTLS files. Node's built-in `https` and `fetch` ignore
 * proxy variables unless `NODE_USE_ENV_PROXY=1`, so a request without this
 * dispatcher goes direct behind a proxy. The caller destroys it.
 */
export async function createEnvHttpDispatcher(
  env: Record<string, string | undefined>,
): Promise<EnvHttpProxyAgent> {
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
  return new EnvHttpProxyAgent({
    // Explicit empty values stop undici from reading `process.env` when `env` is
    // a session's own environment.
    httpProxy: proxy,
    httpsProxy: proxy,
    noProxy: [env.no_proxy, env.NO_PROXY].filter(Boolean).join(",").replace(/\s+/g, ","),
    connect: tls,
    requestTls: tls,
    proxyTls: tls,
  });
}
