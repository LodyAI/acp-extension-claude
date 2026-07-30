import { describe, expect, it } from "vitest";
import { findClaudeAssistantUuidForMessage, findClaudeMessageBeforePrompt } from "../acp-agent.js";

describe("Claude ACP fork message mapping", () => {
  it("selects the ACP assistant message before the active user prompt", () => {
    expect(
      findClaudeMessageBeforePrompt(
        [
          {
            type: "assistant",
            uuid: "completed-assistant",
            parent_tool_use_id: null,
            message: { id: "msg_completed" },
          },
          {
            type: "user",
            uuid: "active-prompt",
          },
          {
            type: "assistant",
            uuid: "active-assistant",
            parent_tool_use_id: null,
          },
        ],
        "active-prompt",
      ),
    ).toBe("msg_completed");
  });

  it("ignores subagent assistant messages", () => {
    expect(
      findClaudeMessageBeforePrompt(
        [
          {
            type: "assistant",
            uuid: "completed-assistant",
            parent_tool_use_id: null,
            message: { id: "msg_completed" },
          },
          {
            type: "assistant",
            uuid: "subagent-assistant",
            parent_tool_use_id: "tool-1",
          },
          {
            type: "user",
            uuid: "active-prompt",
          },
        ],
        "active-prompt",
      ),
    ).toBe("msg_completed");
  });

  it("rejects a stale active prompt marker", () => {
    expect(
      findClaudeMessageBeforePrompt(
        [
          {
            type: "assistant",
            uuid: "completed-assistant",
            parent_tool_use_id: null,
          },
        ],
        "stale-active-prompt",
      ),
    ).toBeNull();
  });

  it("maps an ACP message id back to the top-level Claude assistant uuid", () => {
    expect(
      findClaudeAssistantUuidForMessage(
        [
          {
            type: "assistant",
            uuid: "subagent-assistant",
            parent_tool_use_id: "tool-1",
            message: { id: "msg_target" },
          },
          {
            type: "assistant",
            uuid: "completed-assistant",
            parent_tool_use_id: null,
            message: { id: "msg_target" },
          },
        ],
        "msg_target",
      ),
    ).toBe("completed-assistant");
  });
});
