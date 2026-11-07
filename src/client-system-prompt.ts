import { RequestError } from "@agentclientprotocol/sdk";

export function readClientSystemPrompt(
  value: unknown,
): { mode: "append" | "override"; text: string } | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("mode" in value) ||
    (value.mode !== "append" && value.mode !== "override") ||
    !("content" in value) ||
    !Array.isArray(value.content) ||
    value.content.length === 0
  ) {
    throw RequestError.invalidParams(
      undefined,
      "systemPrompt requires append or override mode and nonempty text content",
    );
  }
  const text = value.content
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
  return { mode: value.mode, text };
}
