# Upstream sync through 2f7e386

This merge incorporates 168 upstream commits after the common ancestor
`4e1fc1e8df2b9af3b1b2d6880ba90c5862283ba8`, through
[`2f7e386`](https://github.com/agentclientprotocol/claude-agent-acp/commit/2f7e386)
(`fix: give subagent checklists their own plan ID`). The latest included upstream
release is 0.102.0. This fork keeps its own release version and package identity;
release-please still determines its next release.

## Client-visible changes

- **Permission defaults:** a new session with no explicit, restored, or configured
  mode now starts in Auto when available. If that built-in default is unsupported
  by the model, it falls back to Manual (`default`); explicitly selected or
  configured Auto instead falls back to Accept edits. Set `permissions.defaultMode` explicitly when the deployment
  requires a particular default. `disableAutoMode: "disable"` is honored at both
  the settings root and under `permissions`.
- **Idle compaction:** an idle session with a one-hour prompt cache and at least
  200,000 context tokens by default can compact automatically about 54 minutes
  after the latest request's first response event. Busy sessions and pending user input prevent compaction. Set
  `idleCompaction: false` to disable this feature; the existing auto-compaction
  disable settings and environment flags also apply.
- **ACP v2:** protocol negotiation now serves v1 and experimental v2 by default.
  `CLAUDE_AGENT_ACP_PROTOCOL=v1` restricts the adapter to v1. V2 reports foreground
  work separately from prompt insertion and background work. Clients should
  consume session state rather than treating prompt acceptance as completion.
  Request validation, cancel/close behavior, dismissed permissions, elicitation,
  config synchronization, replay, and native Windows patch paths are updated.
- **Background work and subagents:** v2 lists background tools, commands and
  monitors, streams command output, and supports the corresponding cancellation
  routes. Native child sessions retain ancestry, model, working directory and
  identity across resumes. Supported clients can keep background children alive
  after a parent cancellation. V2 reports foreground `idle` even while background
  subagents remain active; clients must also inspect the `background` list.
  A later model follow-up starts another foreground cycle.
- **Plans and workflows:** checklists use plan operations with separate child
  plan IDs, reset removes plans, and workflow cards show phases, agents and
  progress. Ultracode and thinking-display configuration are exposed where
  supported.
- **Session UX:** Remote Control commands and messages from other connected
  clients, batch session metadata lookup, cross-directory forks, improved
  authentication/startup/MCP failure notices, and embedded blob resources are
  included. Live settings survive provider refreshes.
- **Model settings:** caller settings now shallow-merge over `CLAUDE_MODEL_CONFIG`
  instead of suppressing it entirely. A caller-provided map replaces the same
  environment-provided map. See [model configuration](model-configuration.md)
  for provider gateway listing behavior.

## Fork-specific integration

- Keep `acp-extension-claude`, Core 0.3.0, the fork's release manifest and changelog,
  and its npm release workflow. The previously removed upstream CI workflow
  remains removed. Upstream preview publishing and registry dispatch are not
  enabled. Binary build scripts and the reusable binary workflow are available;
  the fork's publish workflow does not attach binary archives automatically.
- Preserve Core usage accounting, native turn fork IDs, acknowledged steering,
  negotiated subagent events and prompt suggestions, and elicitation answer notes.
  This does not imply full Core extension parity across protocols: the existing
  v2 adapter filters Lody capability negotiation and does not expose all Core
  custom request handlers. Clients depending on those extensions should retain
  v1 until their required v2 capabilities are verified.
- Preserve session-owned gateway discovery, exact opaque model IDs, and explicit
  effort declarations/overrides. Declared gateway effort does not imply native
  Ultracode workflow support.
- Preserve standard `systemPrompt` precedence over legacy metadata, validation
  before session mutation, and its activation fingerprint. Upstream also notes
  that Claude Code can defer a changed system prompt on resume until compaction.
- Adapt upstream export and protocol snapshots to this fork's existing public
  exports and agent identity.

## Dependencies

| Package                          | Before  | After   |
| -------------------------------- | ------- | ------- |
| `@agentclientprotocol/sdk`       | 1.9.0   | 2.5.0   |
| `@anthropic-ai/claude-agent-sdk` | 0.3.316 | 0.3.321 |
| `acp-extension-core`             | 0.3.0   | 0.3.0   |

Unstable ACP v1 imports move to `@agentclientprotocol/sdk/unstable`; v2 remains an
experimental protocol surface. Development dependencies also follow the upstream
updates, including Vitest 5.1.0.

## Validation

- `npm run build` and `npm run check` passed.
- `npm run test:run`: 70 files passed, 3 skipped; 3,742 tests passed,
  29 skipped.
- `npm run build:binary` and `npm run smoke:binary` passed on the local machine,
  including bundled CLI startup and ACP v1/v2 initialization.
- Live-model integration tests and builds for other operating systems were not run.
