# ACP adapter for the Claude Agent SDK

[![npm](https://img.shields.io/npm/v/acp-extension-claude)](https://www.npmjs.com/package/acp-extension-claude)

Use [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview#branding-guidelines) from [ACP-compatible](https://agentclientprotocol.com) clients!

This tool implements an ACP agent by using the official [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), supporting:

- Context @-mentions
- Images
- Tool calls (with permission requests)
- Following
- Edit review
- TODO lists
- Nested subagent transcripts
- Interactive (and background) terminals
- Custom [Slash commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands)
- Client MCP servers
- Session-scoped long-running goals through the provider-neutral [goal extension](docs/goal-extension.md)
- Structured errors, recovery, and warnings through the opt-in [session failure extension](docs/session-failure-extension.md)
- Concrete model and effort defaults through the opt-in [recommended config value extension](docs/recommended-config-values-extension.md)
- Tool permission presentation, editable choices, and durable effects through the [permission extension](docs/permission-extension.md)

Learn more about the [Agent Client Protocol](https://agentclientprotocol.com/).

## Lody extensions

The adapter advertises versioned capabilities under
`agentCapabilities._meta.lody` using the contracts from `acp-extension-core`.
These cover usage and rate-limit reporting, an independent rate-limit query,
acknowledged steering, goals, subagent/background-task lifecycle, and compaction.
ACP-standard elicitation, plans, session forking, and context-window usage remain
on their standard protocol paths.

Usage accounting reads SDK query-wide model totals (including subagents) and
splits available thinking tokens from output. Each SDK result is its own Core
usage scope (`_meta.lody.usageScopeId` = result uuid) whose `modelUsage` holds
only what that result added to the query-wide reading; results that added
nothing emit no update. A counter below the previous reading marks a new
query() from zero, so the whole reading is new work. Nothing carries across
clear-context restarts, reloads or process restarts: new results bring new
scopes, so a consumer never compares them with an older, larger total. Guessed
prices are omitted for the rest of the query that contained the guess.

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

### Subagent sessions

Subagents are exposed only after bilateral capability negotiation. Until the released ACP SDKs
preserve the draft `clientCapabilities.subagents` field, a supporting client may advertise
`nativeSubagentSessions` in `_meta.jetbrains.air.capabilities`; the adapter mirrors the capability
in its initialize response. The canonical field remains supported and takes precedence once it is
available. Without either client signal, Agent/Task lifecycle keeps its legacy ordinary ACP
tool-call representation and child interactions stay on the root session. Clients that use the
historical `_meta["subagent-transcript"]` capability or `forwardSubagentText` session option retain
the flattened child transcript behavior.

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
