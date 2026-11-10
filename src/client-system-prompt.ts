/**
 * The client-provided system prompt of the unstable `systemPrompt` field on
 * `session/new`, `session/load`, `session/resume`, and `session/fork`.
 *
 * - `append` keeps the Claude Code preset and adds the text after it, the
 *   SDK's `{ type: "preset", preset: "claude_code", append }`.
 * - `override` replaces the Claude Code preset with the text, the SDK's custom
 *   string prompt. Tools, MCP servers, permissions, and settings (including the
 *   CLAUDE.md files that `settingSources` loads) are unchanged.
 *
 * The CLI records the system prompt of a conversation on its first request
 * and reuses it on resume, so a different `systemPrompt` on a later
 * `session/resume` takes effect at the next compaction. The RFD allows this
 * deferral.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { RequestError, type SessionCapabilities } from "@agentclientprotocol/sdk/unstable";

/** The `sessionCapabilities.systemPrompt` the agent advertises: both modes. */
export const SYSTEM_PROMPT_CAPABILITY = {
  mode: { override: {} },
} satisfies NonNullable<SessionCapabilities["systemPrompt"]>;

export type ClientSystemPrompt = { mode: "append" | "override"; text: string };

/**
 * The mode and text of a `systemPrompt`, or `undefined` when the request has
 * none. Throws `invalid_params` for a mode other than `append` and `override`
 * and for a content block other than text: the RFD requires an error, and no
 * session, for a prompt the agent cannot apply.
 */
export function clientSystemPrompt(systemPrompt: unknown): ClientSystemPrompt | undefined {
  if (systemPrompt == null) return undefined;
  if (
    typeof systemPrompt !== "object" ||
    Array.isArray(systemPrompt) ||
    !("mode" in systemPrompt) ||
    (systemPrompt.mode !== "append" && systemPrompt.mode !== "override") ||
    !("content" in systemPrompt) ||
    !Array.isArray(systemPrompt.content) ||
    systemPrompt.content.length === 0
  ) {
    throw RequestError.invalidParams(
      undefined,
      "systemPrompt requires append or override mode and nonempty text content",
    );
  }
  const text = systemPrompt.content
    .map((block: unknown) => {
      if (
        !block ||
        typeof block !== "object" ||
        !("type" in block) ||
        block.type !== "text" ||
        !("text" in block) ||
        typeof block.text !== "string"
      ) {
        throw RequestError.invalidParams(undefined, "systemPrompt supports text blocks only");
      }
      return block.text;
    })
    .join("\n\n");
  return { mode: systemPrompt.mode, text };
}

/**
 * The SDK `systemPrompt` option for a client system prompt. `customInstructions`
 * (AIR's `customInstructions` on `session/new` metadata) still follows the
 * client text in both modes.
 */
export function sdkSystemPrompt(
  prompt: ClientSystemPrompt,
  customInstructions: string | undefined,
): NonNullable<Options["systemPrompt"]> {
  const text = [prompt.text, customInstructions].filter((part) => part).join("\n\n");
  if (prompt.mode === "override") return text;
  return text
    ? { type: "preset", preset: "claude_code", append: text }
    : { type: "preset", preset: "claude_code" };
}

/** Compatibility name for standard prompt validation before session mutation. */
export const readClientSystemPrompt = clientSystemPrompt;
