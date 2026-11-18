import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { RequestError } from "@agentclientprotocol/sdk/unstable";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { messageIdForGrouping } from "../acp-agent.js";
import { forkSession, resolveTurnForkSource } from "../fork-session.js";
import { encodeProjectPath } from "../session-index/project-dirs.js";

// Use the real SDK against temporary transcripts, without starting Claude Code.
let root: string;
let sourceCwd: string;
let destinationCwd: string;
let sessionId: string;
let sourceFile: string;
let transcript: string;
let activeUuid: string;
let projectDir: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fork-session-")));
  sourceCwd = path.join(root, "source");
  destinationCwd = path.join(root, "destination");
  const configDir = path.join(root, "config");
  vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
  await fs.mkdir(sourceCwd);
  await fs.mkdir(destinationCwd);
  sessionId = randomUUID();
  const userUuid = randomUUID();
  const firstUuid = randomUUID();
  const followupUuid = randomUUID();
  activeUuid = randomUUID();
  const common = { sessionId, cwd: sourceCwd, isSidechain: false };
  const entries = [
    {
      ...common,
      type: "user",
      uuid: userUuid,
      parentUuid: null,
      message: { role: "user", content: "First prompt" },
    },
    {
      ...common,
      type: "assistant",
      uuid: firstUuid,
      parentUuid: userUuid,
      message: {
        id: "msg_first",
        role: "assistant",
        content: [{ type: "text", text: "First answer" }],
      },
    },
    {
      ...common,
      type: "user",
      uuid: followupUuid,
      parentUuid: firstUuid,
      message: { role: "user", content: "Follow-up prompt" },
    },
    {
      ...common,
      type: "assistant",
      uuid: randomUUID(),
      parentUuid: followupUuid,
      message: {
        id: "msg_inactive",
        role: "assistant",
        content: [{ type: "text", text: "Inactive answer" }],
      },
    },
    {
      ...common,
      type: "assistant",
      uuid: activeUuid,
      parentUuid: followupUuid,
      message: {
        id: "msg_active",
        role: "assistant",
        content: [{ type: "text", text: "Active answer" }],
      },
    },
  ];
  projectDir = path.join(configDir, "projects", encodeProjectPath(sourceCwd));
  await fs.mkdir(projectDir, { recursive: true });
  ({ file: sourceFile, content: transcript } = await writeTranscript(sessionId, entries));
});

/** Writes the transcript of session `id` in the source project. */
async function writeTranscript(
  id: string,
  entries: Record<string, unknown>[],
): Promise<{ file: string; content: string }> {
  const content =
    entries
      .map((entry, index) =>
        JSON.stringify({ ...entry, timestamp: new Date(1_700_000_000_000 + index).toISOString() }),
      )
      .join("\n") + "\n";
  const file = path.join(projectDir, `${id}.jsonl`);
  await fs.writeFile(file, content);
  return { file, content };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe.each(["same directory", "different directory"])("fork into %s", (directory) => {
  it.each([
    { resolution: "latest", messageId: undefined, expectedAnswer: "Active answer", count: 4 },
    {
      resolution: "active history",
      messageId: "msg_first",
      expectedAnswer: "First answer",
      count: 2,
    },
    {
      resolution: "inactive branch",
      messageId: "msg_inactive",
      expectedAnswer: "Inactive answer",
      count: 4,
    },
    {
      resolution: "fingerprint",
      messageId: "stale-message-id",
      expectedAnswer: "Inactive answer",
      count: 4,
    },
    { resolution: "live map", messageId: "msg_active", expectedAnswer: "Active answer", count: 4 },
  ])("resolves the fork point through $resolution", async (scenario) => {
    const originalMessages = await getSessionMessages(sessionId);
    expect(originalMessages.map(messageIdForGrouping)).not.toContain("msg_inactive");
    const cwd = directory === "same directory" ? sourceCwd : destinationCwd;
    const result = await forkSession(
      {
        sessionId,
        cwd,
        mcpServers: [],
        ...(scenario.messageId && {
          _meta: {
            jetbrains: {
              air: {
                fork: {
                  version: 1,
                  messageId: scenario.messageId,
                  ...(scenario.resolution === "fingerprint" && {
                    messageFingerprint: `sha256:${createHash("sha256").update("Inactive answer").digest("hex")}`,
                    messageOccurrence: 1,
                  }),
                },
              },
            },
          },
        }),
      },
      {
        messageIdForGrouping,
        ...(scenario.resolution === "live map" && {
          liveMessageIdToUuid: new Map([["msg_active", activeUuid]]),
        }),
      },
    );

    expect(result.sessionId).not.toBe(sessionId);
    const messages = await getSessionMessages(result.sessionId);
    expect(messages).toHaveLength(scenario.count);
    expect(messages.at(-1)?.message).toMatchObject({
      content: [{ type: "text", text: scenario.expectedAnswer }],
    });
    const originalUuids = originalMessages.map((message) => message.uuid);
    for (const message of messages) {
      expect(originalUuids).not.toContain(message.uuid);
    }
    expect(await fs.readFile(sourceFile, "utf8")).toBe(transcript);
  });

  it("rejects a fork point that is not in the source session", async () => {
    await expect(
      forkSession(
        {
          sessionId,
          cwd: directory === "same directory" ? sourceCwd : destinationCwd,
          mcpServers: [],
          _meta: { jetbrains: { air: { fork: { version: 1, messageId: "missing" } } } },
        },
        { messageIdForGrouping },
      ),
    ).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining(
        `Fork point message missing was not found in session ${sessionId}`,
      ),
    });
    expect(await fs.readFile(sourceFile, "utf8")).toBe(transcript);
  });
});

describe("resolveTurnForkSource", () => {
  let compactedId: string;
  let compactedFile: string;
  let compactedTranscript: string;
  let beforeCompactionUuid: string;
  let afterCompactionUuid: string;

  // Two turns, a compaction, then one more turn, as Claude Code writes them:
  // the boundary has no parent, so the active chain starts there.
  beforeEach(async () => {
    compactedId = randomUUID();
    const firstPromptUuid = randomUUID();
    beforeCompactionUuid = randomUUID();
    const secondPromptUuid = randomUUID();
    const secondAnswerUuid = randomUUID();
    const boundaryUuid = randomUUID();
    const summaryUuid = randomUUID();
    const thirdPromptUuid = randomUUID();
    afterCompactionUuid = randomUUID();
    const common = { sessionId: compactedId, cwd: sourceCwd, isSidechain: false };
    const answer = (uuid: string, parentUuid: string, id: string, text: string) => ({
      ...common,
      type: "assistant",
      uuid,
      parentUuid,
      message: { id, role: "assistant", content: [{ type: "text", text }] },
    });
    ({ file: compactedFile, content: compactedTranscript } = await writeTranscript(compactedId, [
      {
        ...common,
        type: "user",
        uuid: firstPromptUuid,
        parentUuid: null,
        message: { role: "user", content: "First prompt" },
      },
      answer(beforeCompactionUuid, firstPromptUuid, "msg_first", "First answer"),
      {
        ...common,
        type: "user",
        uuid: secondPromptUuid,
        parentUuid: beforeCompactionUuid,
        message: { role: "user", content: "Second prompt" },
      },
      answer(secondAnswerUuid, secondPromptUuid, "msg_second", "Second answer"),
      {
        ...common,
        type: "system",
        subtype: "compact_boundary",
        uuid: boundaryUuid,
        parentUuid: null,
        logicalParentUuid: secondAnswerUuid,
        content: "Conversation compacted",
        isMeta: false,
        level: "info",
        compactMetadata: { trigger: "auto", preTokens: 200_000 },
      },
      {
        ...common,
        type: "user",
        uuid: summaryUuid,
        parentUuid: boundaryUuid,
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: { role: "user", content: "Summary of the first two turns" },
      },
      {
        ...common,
        type: "user",
        uuid: thirdPromptUuid,
        parentUuid: summaryUuid,
        message: { role: "user", content: "Third prompt" },
      },
      answer(afterCompactionUuid, thirdPromptUuid, "msg_third", "Third answer"),
    ]));
  });

  async function transcriptFiles(): Promise<string[]> {
    return (await fs.readdir(projectDir)).filter((name) => name.endsWith(".jsonl")).sort();
  }

  it("forks with resumeSessionAt at a turn after the latest compaction", async () => {
    const before = await transcriptFiles();

    await expect(resolveTurnForkSource(compactedId, afterCompactionUuid)).resolves.toEqual({
      creation: { resume: compactedId, forkSession: true, resumeSessionAt: afterCompactionUuid },
    });
    expect(await transcriptFiles()).toEqual(before);
  });

  it("copies the transcript up to a turn before the latest compaction", async () => {
    // What Claude Code's resumeSessionAt searches: the turn is not there.
    expect((await getSessionMessages(compactedId)).map((message) => message.uuid)).not.toContain(
      beforeCompactionUuid,
    );

    const source = await resolveTurnForkSource(compactedId, beforeCompactionUuid);

    expect(source.copiedSessionId).toBeDefined();
    expect(source.copiedSessionId).not.toBe(compactedId);
    expect(source.creation).toEqual({ resume: source.copiedSessionId });
    const messages = await getSessionMessages(source.copiedSessionId!);
    expect(messages.map((message) => message.message)).toMatchObject([
      { content: "First prompt" },
      { content: [{ type: "text", text: "First answer" }] },
    ]);
    expect(await fs.readFile(compactedFile, "utf8")).toBe(compactedTranscript);
  });

  it.each([
    {
      case: "a turn that is not in the transcript",
      session: () => compactedId,
      turnId: "missing-turn",
      error: () => ({
        code: -32602,
        message: expect.stringContaining(
          `Fork turn missing-turn was not found in session ${compactedId}`,
        ),
      }),
    },
    {
      case: "a session without a transcript",
      session: () => "33333333-3333-4333-8333-333333333333",
      turnId: "missing-turn",
      error: () => ({
        code: RequestError.sessionNotFound("33333333-3333-4333-8333-333333333333").code,
      }),
    },
  ])("rejects $case without copying", async (scenario) => {
    const before = await transcriptFiles();

    await expect(resolveTurnForkSource(scenario.session(), scenario.turnId)).rejects.toMatchObject(
      scenario.error(),
    );
    expect(await transcriptFiles()).toEqual(before);
  });
});
