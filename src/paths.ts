import os from "node:os";
import path from "node:path";

function expandHomeDir(rawPath: string, homeDir = os.homedir()): string {
  const trimmed = rawPath.trim();
  if (trimmed === "~" || trimmed === "$HOME" || trimmed === "${HOME}") {
    return homeDir;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homeDir, trimmed.slice(2));
  }
  if (trimmed.startsWith("$HOME/") || trimmed.startsWith("$HOME\\")) {
    return path.join(homeDir, trimmed.slice("$HOME/".length));
  }
  if (trimmed.startsWith("${HOME}/") || trimmed.startsWith("${HOME}\\")) {
    return path.join(homeDir, trimmed.slice("${HOME}/".length));
  }
  return trimmed;
}

/** The Claude configuration directory: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export function claudeConfigDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  const homeDir = os.homedir();
  return configured ? expandHomeDir(configured, homeDir) : path.join(homeDir, ".claude");
}
