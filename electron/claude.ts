import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Lance Claude Code en local (`claude -p`) avec un agent de l'équipe.
 * L'agent ne peut ni écrire ni exécuter de commande : il propose, l'app
 * montre la proposition, et c'est l'utilisateur qui l'applique.
 */

const HOME = os.homedir();

/** Outils retirés à l'agent : il lit et cherche, il n'écrit rien. */
const OUTILS_INTERDITS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];
const DELAI_MAX_MS = 10 * 60 * 1000;

/** Le binaire de l'extension VS Code ou Cursor la plus récente. */
function fromEditorExtensions(): string[] {
  const found: string[] = [];
  for (const base of [".vscode/extensions", ".cursor/extensions"]) {
    const dir = path.join(HOME, base);
    if (!existsSync(dir)) continue;
    const versions = readdirSync(dir)
      .filter((d) => d.startsWith("anthropic.claude-code-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) found.push(path.join(dir, v, "resources", "native-binary", "claude"));
  }
  return found;
}

/** Une app lancée depuis le Finder n'hérite pas du PATH du terminal : on cherche aussi aux endroits habituels. */
export function findClaude(): string | null {
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "claude"));
  const candidates = [
    process.env.KLYRA_CLAUDE_PATH,
    ...fromPath,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(HOME, ".local/bin/claude"),
    path.join(HOME, ".claude/local/claude"),
    path.join(HOME, ".npm-global/bin/claude"),
    ...fromEditorExtensions(),
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export interface ClaudeResult {
  ok: boolean;
  text: string;
  /** Message lisible en cas d'échec. */
  error?: string;
  costUsd?: number;
}

const running = new Map<string, ChildProcess>();

export function runAgent(requestId: string, agent: string, prompt: string): Promise<ClaudeResult> {
  const bin = findClaude();
  if (!bin) {
    return Promise.resolve({ ok: false, text: "", error: "Claude Code est introuvable sur ce poste." });
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent)) {
    return Promise.resolve({ ok: false, text: "", error: "Nom d’agent invalide." });
  }

  return new Promise((resolve) => {
    const child = spawn(bin, ["-p", "--agent", agent, "--output-format", "json", "--disallowedTools", ...OUTILS_INTERDITS], {
      cwd: HOME,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    running.set(requestId, child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timeout = setTimeout(() => child.kill("SIGTERM"), DELAI_MAX_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      running.delete(requestId);
      resolve({ ok: false, text: "", error: `Impossible de lancer Claude Code : ${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      running.delete(requestId);
      if (signal) {
        resolve({ ok: false, text: "", error: "Demande annulée." });
        return;
      }
      try {
        const json = JSON.parse(stdout) as { result?: string; is_error?: boolean; total_cost_usd?: number };
        if (json.is_error || code !== 0) {
          resolve({ ok: false, text: "", error: json.result || stderr.trim() || `Claude Code a échoué (code ${code}).` });
          return;
        }
        resolve({ ok: true, text: json.result ?? "", costUsd: json.total_cost_usd });
      } catch {
        resolve({ ok: false, text: "", error: stderr.trim() || stdout.trim() || `Claude Code a échoué (code ${code}).` });
      }
    });

    // Le prompt passe par l'entrée standard : aucune limite de longueur ni d'échappement.
    child.stdin.end(prompt);
  });
}

export function cancelAgent(requestId: string): void {
  running.get(requestId)?.kill("SIGTERM");
}
