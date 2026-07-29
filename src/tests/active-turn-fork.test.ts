import { describe, expect, it } from "vitest";
import { findClaudeForkPointBeforePrompt } from "../acp-agent.js";

describe("findClaudeForkPointBeforePrompt", () => {
  it("selects the completed assistant message before the active user prompt", () => {
    expect(
      findClaudeForkPointBeforePrompt(
        [
          {
            type: "assistant",
            uuid: "completed-assistant",
            parent_tool_use_id: null,
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
    ).toBe("completed-assistant");
  });

  it("ignores subagent assistant messages", () => {
    expect(
      findClaudeForkPointBeforePrompt(
        [
          {
            type: "assistant",
            uuid: "completed-assistant",
            parent_tool_use_id: null,
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
    ).toBe("completed-assistant");
  });

  it("rejects a stale active prompt marker", () => {
    expect(
      findClaudeForkPointBeforePrompt(
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
});
