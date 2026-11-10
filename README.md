# ACP adapter for the Claude Agent SDK

[![npm](https://img.shields.io/npm/v/acp-extension-claude)](https://www.npmjs.com/package/acp-extension-claude)

Use [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview#branding-guidelines) from [ACP-compatible](https://agentclientprotocol.com) clients!

This tool implements an ACP agent by using the official [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), supporting:

- Context @-mentions
- Images
- Tool calls (with permission requests)
- Compact file changes through the negotiated [AIR diff patch extension](docs/air-extensions.md#diff-patch)
- Following
- Edit review
- TODO lists
- Nested subagent transcripts
- Interactive (and background) terminals
- Custom [Slash commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands)
- Client MCP servers
- An Ultracode session config option, which turns on Claude Code's dynamic workflows for every task. It appears when dynamic workflows are enabled and the model supports ultracode (any model with `xhigh` effort)
- `/mcp` in the chat: the MCP server status as a list. The adapter runs `/mcp reconnect`, `/mcp enable`, and `/mcp disable` through the SDK control API, because Claude Code refuses them in SDK mode. A reconnect of an ACP server that needs authentication starts MCP OAuth through URL elicitation
- Session-scoped long-running goals for AIR through the [goal extension](docs/air-extensions.md#goal) under `_meta.jetbrains.air.goal`
- Structured errors, recovery, and warnings through the opt-in [session failure extension](docs/air-extensions.md#session-failure)
- Concrete model and effort defaults through the opt-in [recommended config value extension](docs/air-extensions.md#recommended-config-values)
- Tool permission presentation, editable choices, and durable effects through the [permission extension](docs/air-extensions.md#permission-presentation)
- One fact per field in every tool call report, as the [ACP tool call contract](docs/air-extensions.md#tool-call-contract) defines
- All AIR extensions, capabilities, and `_meta` keys: [AIR extensions](docs/air-extensions.md)

Learn more about the [Agent Client Protocol](https://agentclientprotocol.com/).

## Anthropic-compatible gateway models

When a session has a custom `ANTHROPIC_BASE_URL`, the adapter discovers its model
catalog during session creation. It requests `<base>/v1/models` (without doubling
an existing `/v1`), preserves path prefixes, and follows Anthropic `has_more` /
`last_id` pagination using `after_id`. OpenAI-shaped `{ "data": [{ "id": "vendor/model" }] }`
lists also work; `display_name` is optional. No settings file is written.

The ACP model selector contains the freshly discovered IDs plus the SDK's Default
entry. Exact IDs are passed to Claude Code without alias or family matching.
Effective `availableModels` and managed `deniedModels` still restrict selection;
old allowlist entries do not create rows absent from the gateway. Remove obsolete
restrictions only if you intend to change that policy. A successful empty catalog
leaves Default, while a failed discovery falls back to the existing SDK/settings
list and emits a content-free stderr diagnostic.

Discovery uses session environment and enabled settings sources, including
programmatic and managed settings. `ANTHROPIC_AUTH_TOKEN` uses Bearer authentication;
otherwise `ANTHROPIC_API_KEY` uses `x-api-key`. `ANTHROPIC_CUSTOM_HEADERS` is supported.
Subscription OAuth tokens and `apiKeyHelper` are not used by the catalog client.
HTTP(S) proxy variables, both `NO_PROXY` spellings, `NODE_EXTRA_CA_CERTS`, and
`CLAUDE_CODE_CLIENT_CERT` / `CLAUDE_CODE_CLIENT_KEY` / `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE`
are applied to a session-owned HTTP client. Redirects are rejected. Discovery is
bounded to five seconds, 2 MiB, 4096 unique models and 32 pages; cancellation releases
the client. Native Anthropic, Bedrock, Vertex and Foundry retain SDK discovery.
Set `CLAUDE_ACP_MODEL_DISCOVERY=off` to disable the gateway request.

Gateway entries may declare `supported_reasoning_levels: [{ "effort": "low" },
{ "effort": "high" }]`. The adapter exposes those effort choices for any model ID,
limited to levels accepted by the pinned Claude SDK: `low`, `medium`, `high`,
`xhigh`, and `max`. Other levels are not translated into a different effort.
Missing or malformed capability metadata leaves effort unknown and does not remove
the model. Effort metadata does not enable Fast mode, Auto mode, or adaptive thinking.

To supply or override effort choices for a gateway model, set
`CLAUDE_ACP_MODEL_EFFORTS` in the Provider environment (or Claude settings `env`)
to a JSON object, for example:

```json
{ "vendor/model-a": ["low", "medium", "high"], "vendor/model-b": [] }
```

Overrides take precedence over gateway declarations and match exact model IDs.
An empty array disables the effort selector for that model. They do not add absent
models, bypass model allowlists/managed denials, or change native/disabled discovery.
Invalid overrides fail session creation with a configuration error. The effective
session environment and settings precedence also apply to this variable. Refresh
Provider capabilities and start a new session after changing it; existing sessions
retain their catalog snapshot. SDK/backend rejections propagate without changing
the selected effort to a value that failed to apply.

There is no cross-session catalog cache. A client capability refresh that creates
a new adapter session fetches again; an already running session keeps its snapshot.
A client serving its own cached capabilities does not invoke the adapter.
Directory entries alone do not establish effort, Fast, Auto-mode, image or Messages
compatibility. The adapter does not borrow Claude family capabilities for these
entries; the gateway must support Claude Code's Messages requests and tool protocol.

For a local build, run `npm ci`, `npm run build`, then configure an ACP client to
launch `node /absolute/path/to/acp-extension-claude/dist/index.js`, with the gateway
URL/token in that Agent's environment. Use Node 22.19+ (or a supported newer LTS).
This runs the local adapter without changing the client's bundled adapter or the
user's Claude settings. Credentials must not be placed in command-line arguments.

## Lody extensions

With bilateral `_meta.lody.subagentEvents: { version: 1 }`, native subagent
lifecycle, SDK progress, and child text/thought/tool/plan updates use Core's
root-scoped `_lody/subagents/event` envelope. Legacy clients retain their existing
native or task-metadata path. Child permission tools are namespaced on the root
connection; normalized runs do not advertise cancellation or output-tail queries.
Live child history is retained by Lody, not replayed into the parent's transcript.
The subagent event contract and helper are supplied by Core 0.1.9.

The adapter advertises versioned capabilities under
`agentCapabilities._meta.lody` using the contracts from `acp-extension-core`.
These cover usage and rate-limit reporting, an independent rate-limit query,
acknowledged steering, goals, subagent/background-task lifecycle, and compaction.
ACP-standard elicitation, plans, session forking, and context-window usage remain
on their standard protocol paths.

Usage accounting reads SDK query-wide model totals (including subagents) and
splits available thinking tokens from output. Each SDK result is its own Core
usage scope (`_meta.lody.usageScopeId` = result uuid) whose `modelUsage` and
`delta` hold only what that result added to the query-wide reading; results that
added nothing emit no update. A resumed query() (plain resume or resume +
forkSession) continues the running total Claude Code saved in the `resume`
transcript's last `cost-state` record, so that record seeds the reading and
history is never billed again; `forkSession()` copies and fresh sessions start
from zero. The baseline is read off the load path and applied before the first
result; if the transcript cannot be read, the first result only anchors.
Zeroed crash results do not reset the reading. Guessed prices are omitted for
the rest of the query that contained the guess.

Acknowledged steering uses `_lody/session/steer { sessionId, prompt, steerId }`
(`transport: "request"`, `upstreamTurn: "same"`, `configPolicy: "apply"`). The
steer joins the running turn: the adapter pushes it as an `SDKUserMessage` with
`priority = "now"` (or `later` while a permission/elicitation is pending, so its
input card is not interrupted) and answers `injected`. With no running turn, or
once the running turn is settling or cancelled, it rejects with JSON-RPC
`invalid request` (`-32600`): the input was not enqueued. The client requeues the
same message as an ordinary `session/prompt` after the current prompt finishes.
This is the shared acknowledged-steer refusal contract: only a proven refusal
permits automatic retry; `failed`, internal errors, and transport failures remain
ambiguous and must not be automatically resent. Submission is not application.
The original `session/prompt` stays open until the steered work
finishes and returns one response whose usage covers every cycle it ran.

`_lody/session/steer_applied { sessionId, steerId }` is sent when the SDK replays
the steered message, which is when Claude Code confirms taking it into the turn.
Some streamed output may precede this replay; the notification is the logical
ownership boundary, not a guarantee that no steered output appeared earlier.
For an applied steer it precedes the `session/prompt` response.
Output before the notification belongs to the earlier logical turn; output after
it belongs to the steer. A steer overtaken by `session/cancel` is never
acknowledged; the client cannot tell whether it ran. File-change reports stay
scoped to the ACP prompt, so they span every logical turn a prompt covered.

AskUserQuestion notes require form elicitation plus
`clientCapabilities._meta.lody.elicitation = { version: 1, answerNotes: true }`.
The separate `noteFor` field adds an SDK annotation without replacing a selection;
`customAnswerFor` retains its replacement semantics for all clients.

### Standalone executables

Upstream releases attach archives for Linux (glibc and musl), macOS and Windows, on
x64 and arm64, to the [upstream GitHub release](https://github.com/agentclientprotocol/claude-agent-acp/releases).
They need no Node.js install. Each holds two files: `claude-agent-acp`, and the
Claude CLI (`claude`) it runs. Keep them in the same directory; a symlink to
`claude-agent-acp` elsewhere works. To use a Claude CLI you already have
instead, set `CLAUDE_CODE_EXECUTABLE`. On Alpine, install `libgcc` and
`libstdc++` first.

To build one for your machine (needs [Bun](https://bun.sh)) and check it:

```sh
npm run build:binary
npm run smoke:binary            # add `-- --full` to drive a real session; needs a Claude login
```

### Subagent sessions

A client that declares `clientCapabilities.subagents`, other than JetBrains AIR, gets each Agent or
Task subagent as its own child session, following the [subagents RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/subagents.mdx):

- `subagent_update` on the parent announces the child before any of its traffic, with the
  parent's `title` and `description` for it, and reports its work state: `running`,
  `requires_action` while one of its requests is open (and `running` again when the last one ends,
  unless a cancel withdrew it: the child is stopping then), and `idle` when its work ends, with
  `end_turn` or `cancelled` when the SDK gives the reason. A failure is `idle` with the `error`
  stop reason and the SDK's error text as its `error`. The child keeps its session for every
  delegation to it.
- A child that runs outside its parent's working directory, such as an Agent call with
  `isolation: "worktree"`, gets its `cwd` on `subagent_update` before its first tool call. The
  adapter takes it from the `cwd` of the child's own hooks: its SubagentStart hook runs before its
  first model request. It sends `cwd: null` when the child is back in its parent's directory. A
  child in its parent's directory gets no `cwd`, and no child gets `additionalDirectories`: Claude
  Code gives a subagent the session's additional directories, so it inherits them. A replay
  announces a child with the `cwd` that its transcript recorded, and clears it after the response
  when that directory no longer exists.
- Session messages replace the Agent or Task call that launches the child, which its parent is
  not shown:
  - The launch's prompt is a `session_message` in both transcripts: the parent's outgoing view and
    the child's incoming one. Both use the launch's tool use id, and each names the other with the
    draft RFD's `recipientMessageId` and `senderMessageId`.
  - A foreground child's answer, from the launch's result, is the child's `session_message` to
    the parent. In Claude Code's hand-back mode, the child's `SubagentHandback` call is its
    message to the parent instead, in both transcripts and linked the same way.
  - A launch whose child is never exposed is shown as a tool call after all, with its final
    status.
- The message of a SendMessage call that resumes the child is a `session_message` in the child's
  transcript. The SendMessage call stays a tool call of the session that made it.
- `session/cancel` on the parent interrupts Claude Code, which stops the foreground children that
  the turn waits on. Background children keep running, as the RFD prefers; a client stops one with
  its own `cancel`. Each stopped child reports `idle` with `cancelled` from Claude Code's own
  events, and its open requests are withdrawn. The adapter ends no child at a cancel itself, so a
  child that keeps running keeps its open requests and its open tool calls. To spare background
  children, the adapter declares the SDK option `perTaskStopAffordance`, which a client can turn
  off in `_meta.claudeCode.options`. That option spares background workflows too, which a client
  cannot stop, so the adapter stops them after the interrupt, as Claude Code did without it.
  Background commands keep running after a cancel either way. A tool call of a stopped child that Claude Code reports no
  result for, such as the command it was running, ends in the child's session before the cancelled
  prompt resolves. When Claude Code stops a background child after that, or while no prompt runs,
  the tool call ends right after the child reports `idle`. A child that still runs when Claude Code
  exits is `idle` with no stop reason.
- A child whose parent is not yet known when it ends is not exposed, since the RFD forbids
  guessing its parent.
- A replay restores each child under its live session id, from its own transcript, with the same
  session messages as live, and its end is an `idle` before the response.
  A launch without Claude Code's metadata file for the child stays an ordinary tool call of the
  parent, and a notice, for a client that takes notices, says that subagent history is missing.
- After a load or resume, with or without replay, a SendMessage that resumes an agent from before
  it runs that agent in its session from before. Before the agent's traffic, each of its ancestors
  that the client was not told about in this connection is announced, parent before child and
  with no work state, as the RFD requires. An agent whose launch the session's history does not
  record stays unexposed.
- Each running child is announced with the `cancel` capability. `session/cancel` with the child's
  session id stops that child's current work, through the SDK's `Query.stopTask`, and not its
  parent's: Claude Code also stops the foreground children it waits on, and the parent's turn goes
  on. Each stopped child reports `idle` with `cancelled` from Claude Code's own events, and its
  requests that the stop withdraws report no `running` first. A replayed child, which no longer
  runs, gets no capabilities. A client cannot prompt or otherwise change a child.

An [ACP v2](#experimental-acp-v2) client gets the same without declaring anything, since subagents
are part of v2's baseline. Each child also reports its work state as its own `state_update`, right
after the parent's copy.

JetBrains AIR keeps the earlier draft of the RFD (`subagent_spawned`, `subagent_state_update`),
which it enables with `nativeSubagentSessions` in `_meta.jetbrains.air.capabilities`. See
[AIR extensions](docs/air-extensions.md#native-subagent-sessions).

Without either signal, Agent and Task stay ordinary tool calls and child interactions stay on the
root session. Clients that use the historical `_meta["subagent-transcript"]` capability or the
`forwardSubagentText` session option retain the flattened child transcript.

### Experimental ACP v2

The adapter also serves the [draft ACP v2](https://agentclientprotocol.com/protocol/v2/overview):
a client that asks for protocol version 2 or later in `initialize` gets v2, and every other client
gets v1. The draft can still change, and this surface changes with it.

`CLAUDE_AGENT_ACP_PROTOCOL` limits the adapter to one version. With `v1`, a client that asks
for v2 is negotiated down to v1. With `v2`, the adapter rejects the `initialize` of a v1 client.
`auto`, the default, serves both.

On v2 the adapter serves the session baseline (`session/new`, `session/list`, `session/resume`
with replay, `session/close`, `session/prompt`, `session/cancel`), `session/delete`,
`session/fork`, additional directories, config options (the mode is one), plans, notices,
compaction, display terminals for commands, permission requests, elicitation, providers, auth, and
[subagents](#subagent-sessions). Steering and the AIR extensions are v1 only for now.

## Contribution Policy

This project does not require a Contributor License Agreement (CLA). Instead, contributions are accepted under the following terms:

> By contributing to this project, you agree that your contributions will be licensed under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0). You affirm that you have the legal right to submit your work, that you are not including code you do not have rights to, and that you understand contributions are made without requiring a Contributor License Agreement (CLA).

## Automatic session titles

The adapter advertises Core `agentCapabilities._meta.lody.sessionTitle: { version: 1 }`.
It uses the existing ACP `session/update` callback with `session_info_update` and
`_meta.lody.titleSource`: `generated` for SDK generation, `explicit` for persisted
custom names (the SDK combines generated names and user renames), and `fallback`
for prompt summaries. Hosts can skip their own title process while rejecting
fallback previews. A change of source is published even when the text is unchanged.

## Prompt suggestions

Both peers opt in using `_meta.lody.promptSuggestions: { version: 1 }`.
Negotiation enables SDK `promptSuggestions` unless
`_meta.claudeCode.options.promptSuggestions` is explicitly false. Without
negotiation, existing provider options remain unchanged and no Core suggestions
are sent. Native settings, environment and quota suppression still apply.

The long-lived SDK consumer forwards `prompt_suggestion` as
`_lody/session/prompt_suggestion`, with the owning ACP `sessionId`, SDK `uuid` as
`suggestionId`, and `{ type: "completed", text: suggestion }`. A recreated query's
native session ID is mapped back to its ACP owner. The SDK provides no source
turn, so `sourceTurnId` is omitted. Late/stale suggestions are allowed: the adapter
neither guesses a turn nor filters by the latest prompt. Delivery does not hold
prompt completion and never becomes assistant text. Silence is not an error.

This integration uses the prompt-suggestion contract from the pinned
`acp-extension-core@0.3.0` dependency.

## Client system prompts

The adapter advertises `sessionCapabilities.systemPrompt.mode.override` and accepts
standard ACP `systemPrompt` on `session/new`, `session/load`, `session/resume`, and
`session/fork`:

```json
{
  "systemPrompt": {
    "mode": "append",
    "content": [{ "type": "text", "text": "Use the project's terminology." }]
  }
}
```

`append` adds instructions to the native prompt; `override` replaces its base
instructions. Content must contain at least one text block; unsupported modes or
content return `invalidParams` (-32602). These instructions do not change tool
permissions or remove required runtime context. They apply to the requested
session, not sibling sessions. Pass them again when reconnecting or forking to
ensure the same instructions are used.

Standard `systemPrompt` takes precedence over legacy `_meta.systemPrompt` and
`_meta.claudeCode.options.systemPrompt`. Append retains the Claude Code preset and
AIR instructions. Changing the value on an idle load/resume rebuilds the native
query; a busy session rejects the change. Omitting it uses the normal legacy/default
configuration. Existing conversation history is unchanged.
