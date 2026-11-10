import { describe, expect, it } from "vitest";

describe("module runtime exports", () => {
  /**
   * The public runtime exports of lib.ts must change only deliberately; consumers import these names.
   */
  it("lib.ts exports the expected names", async () => {
    expect(Object.keys(await import("../lib.js")).sort()).toEqual([
      "AUTH_STATUS_UPDATE_METHOD",
      "CLAUDE_STEER_APPLIED_METHOD",
      "ClaudeAcpAgent",
      "Pushable",
      "SettingsManager",
      "UsageApiDeps",
      "getUsage",
      "isLocalCommandMetadata",
      "nodeToWebReadable",
      "nodeToWebWritable",
      "planEntries",
      "runAcp",
      "streamEventToAcpNotifications",
      "stripLocalCommandMetadata",
      "toAcpNotifications",
      "toDisplayPath",
      "toolInfoFromToolUse",
      "toolUpdateFromToolResult",
      "unreachable",
    ]);
  });

  /**
   * Moving code out of acp-agent.ts must keep every name re-exported, since consumers deep-import
   * dist/acp-agent.js; change this list only deliberately.
   */
  it("acp-agent.ts exports the expected names", async () => {
    expect(Object.keys(await import("../acp-agent.js")).sort()).toEqual([
      "CLAUDE_LODY_CAPABILITIES",
      "CLAUDE_STEER_APPLIED_METHOD",
      "ClaudeAcpAgent",
      "EFFORT_CONFIG_ID",
      "FAST_MODE_CONFIG_ID",
      "FAST_MODE_OFF",
      "FAST_MODE_ON",
      "MODEL_CONFIG_ID",
      "MODE_CONFIG_ID",
      "STEER_METHOD",
      "applyAvailableModelsAllowlist",
      "buildConfigOptions",
      "buildModelCapabilitiesMeta",
      "clientSupportsBooleanConfigOptions",
      "clientSupportsRecommendedConfigValue",
      "computeSessionFingerprint",
      "createFastModeConfigOption",
      "fastModeStateEnabled",
      "isLocalCommandMetadata",
      "isLoginRequiredText",
      "isReplayHiddenMetaMessage",
      "isSyntheticLoginMessage",
      "matchResumedModel",
      "messageIdForGrouping",
      "normalizeFastModeDisabledReason",
      "promptToClaude",
      "resolveFastModeEnabled",
      "resolveModelPreference",
      "runAcp",
      "runPromptWithCancellation",
      "settingsEffortForModel",
      "streamEventToAcpNotifications",
      "stripLocalCommandMetadata",
      "toAcpNotifications",
      "v1AgentApp",
    ]);
  });
});
