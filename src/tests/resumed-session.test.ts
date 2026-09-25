import { describe, expect, it } from "vitest";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { resumedModelFromTranscript, usageBaselineFromTranscript } from "../resumed-session.js";

function assistant(
  model: unknown,
  nesting: Pick<SessionMessage, "parent_tool_use_id" | "parent_agent_id"> = {
    parent_tool_use_id: null,
    parent_agent_id: null,
  },
): SessionMessage {
  return {
    type: "assistant",
    uuid: crypto.randomUUID(),
    session_id: "session-id",
    ...nesting,
    message: { model },
  };
}

describe("resumedModelFromTranscript", () => {
  it("returns the last real assistant model", () => {
    expect(
      resumedModelFromTranscript([assistant("claude-sonnet-5"), assistant("claude-opus-5")]),
    ).toBe("claude-opus-5");
  });

  it("skips synthetic assistant records after the real response", () => {
    expect(resumedModelFromTranscript([assistant("claude-opus-5"), assistant("<synthetic>")])).toBe(
      "claude-opus-5",
    );
  });

  it("skips nested assistant records that can use a different model", () => {
    expect(
      resumedModelFromTranscript([
        assistant("claude-opus-5"),
        assistant("claude-haiku-4-5", {
          parent_tool_use_id: "task-tool-use",
          parent_agent_id: null,
        }),
      ]),
    ).toBe("claude-opus-5");
  });

  it("returns undefined when the transcript has no real assistant model", () => {
    expect(resumedModelFromTranscript([assistant("<synthetic>")])).toBeUndefined();
  });
});

describe("usageBaselineFromTranscript", () => {
  const costState = (inputTokens: number, extra: Record<string, unknown> = {}) => ({
    type: "cost-state",
    sessionId: "session-id",
    totalCostUSD: 0.03,
    modelUsage: {
      "claude-haiku-4-5": {
        inputTokens,
        outputTokens: 100,
        thinkingTokens: 72,
        cacheReadInputTokens: 15176,
        cacheCreationInputTokens: 16129,
        webSearchRequests: 0,
        costUSD: 0.03,
      },
    },
    hasUnknownModelCost: false,
    ...extra,
  });

  it("uses the last cost-state, which Claude Code restores on resume", () => {
    const baseline = usageBaselineFromTranscript([
      costState(919),
      { type: "assistant", uuid: "a" },
      costState(929, { hasUnknownModelCost: true }),
      { type: "last-prompt" },
    ]);
    expect(baseline).toEqual({
      known: true,
      modelUsage: costState(929).modelUsage,
      hasUnknownModelCost: true,
    });
  });

  it("starts from zero when no process ever saved a running total", () => {
    expect(usageBaselineFromTranscript([{ type: "user", uuid: "u" }])).toEqual({
      known: true,
      modelUsage: {},
      hasUnknownModelCost: false,
    });
  });
});
