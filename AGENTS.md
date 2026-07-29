# Repository Guidelines

## Pull Requests

- Always open pull requests against the `loro-dev` organization repository
  (`loro-dev/acp-extension-claude`), not a personal fork.

## ACP Message Forks

- `_meta.lody.forkAtMessage` carries the standard ACP `messageId`, never a Claude SDK uuid.
  Resolve only a top-level assistant transcript message and pass its SDK uuid to
  `resumeSessionAt`; keep provider-native identifiers inside this adapter.
