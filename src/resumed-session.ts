import {
  getSessionMessages,
  importSessionToStore,
  type SessionMessage,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { SessionTiming } from "./session-timing.js";
import type { SdkUsageCounters } from "./usage.js";

type ResumeLogger = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type ResumedSessionSnapshot = {
  messages?: SessionMessage[];
  model?: string;
};

/** Return the concrete model recorded by the last real assistant response.
 * Claude Code restores a resumed query from this same transcript field.
 * Synthetic assistant records use angle-bracket placeholders and do not
 * describe a model the resumed query can run. */
export function resumedModelFromTranscript(messages: SessionMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const entry = messages[index];
    if (
      entry?.type !== "assistant" ||
      entry.parent_tool_use_id != null ||
      entry.parent_agent_id != null ||
      !entry.message ||
      typeof entry.message !== "object"
    ) {
      continue;
    }
    const model = (entry.message as { model?: unknown }).model;
    if (typeof model === "string" && model.trim().length > 0 && !/^<[^>]+>$/.test(model.trim())) {
      return model.trim();
    }
  }
  return undefined;
}

/** Read the resume model from the local transcript without starting a Claude
 * control request. This is intentionally on the load critical path. */
export async function readResumedSession(
  sessionId: string,
  logger?: ResumeLogger,
): Promise<ResumedSessionSnapshot> {
  const timing = new SessionTiming(logger, "models", sessionId);
  try {
    // Deliberately search all project directories, matching replaySessionHistory.
    // A client may reopen a session from a worktree or normalized path that is
    // different from the directory under which Claude persisted the transcript.
    const messages = await getSessionMessages(sessionId);
    const model = resumedModelFromTranscript(messages);
    timing.phase("read-transcript", ` messages=${messages.length} model=${model ?? "unknown"}`);
    return { messages, model };
  } catch (error) {
    timing.phase("read-transcript", " outcome=error");
    logger?.error(`Failed to read transcript for resumed session ${sessionId}:`, error);
    return {};
  }
}

/** Accounting baseline a resumed query() starts from. `known: false` means the
 * transcript could not be read, so the first result must only anchor. */
export type ResumedUsageBaseline =
  | { known: true; modelUsage: Record<string, SdkUsageCounters>; hasUnknownModelCost: boolean }
  | { known: false };

/** Claude Code restores `result.modelUsage` from the transcript's last
 * `cost-state` record: its own for a resume, the source session's for a
 * resume + forkSession. No record means the running total starts from zero.
 * Per-message usage is not a substitute: it omits internal pipeline calls. */
export function usageBaselineFromTranscript(entries: SessionStoreEntry[]): ResumedUsageBaseline {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "cost-state") continue;
    const modelUsage = entry.modelUsage;
    if (!modelUsage || typeof modelUsage !== "object") break;
    return {
      known: true,
      modelUsage: modelUsage as Record<string, SdkUsageCounters>,
      hasUnknownModelCost: entry.hasUnknownModelCost === true,
    };
  }
  return { known: true, modelUsage: {}, hasUnknownModelCost: false };
}

export async function readResumedUsageBaseline(
  sessionId: string,
  logger?: ResumeLogger,
): Promise<ResumedUsageBaseline> {
  const entries: SessionStoreEntry[] = [];
  try {
    // Search every project directory, like the SDK's own resume lookup.
    await importSessionToStore(
      sessionId,
      { append: async (_key, batch) => void entries.push(...batch), load: async () => null },
      { includeSubagents: false },
    );
    return usageBaselineFromTranscript(entries);
  } catch (error) {
    logger?.error(`Failed to read usage baseline for resumed session ${sessionId}:`, error);
    return { known: false };
  }
}
