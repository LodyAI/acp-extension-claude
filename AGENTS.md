# Repository Guidelines

## Pull Requests

- Always open pull requests against the `loro-dev` organization repository
  (`loro-dev/acp-extension-claude`), not a personal fork.

## ACP Turn Forks

- Agent message updates expose the top-level Claude SDK assistant uuid as
  `_meta.lody.turnId`. `_meta.lody.forkAtTurn.turnId` returns that value unchanged
  and passes it directly to `resumeSessionAt`; do not maintain a message-id mapping.
