import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
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

/* ─── Conversation en direct ───────────────────────────────────── */

/** Ce que l'interface reçoit pendant qu'un agent travaille (cf. src/lib/bridge.ts). */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  /** Un morceau du texte de la réponse. `nouveauBloc` : il suit des étapes, on passe à la ligne. */
  | { type: "texte"; delta: string; nouveauBloc: boolean }
  /** Une étape : lire un fichier, lancer une commande, confier à un agent… */
  | { type: "etape"; id: string; outil: string; entree: Record<string, unknown>; parent: string | null }
  | { type: "etape-fin"; id: string; ok: boolean; apercu: string }
  | { type: "fin"; ok: boolean; texte: string; erreur?: string; costUsd?: number; sessionId?: string };

export interface StreamOptions {
  /** Le sous-agent qui répond (`~/.claude/agents/<nom>.md`), ou null pour la session principale. */
  agent: string | null;
  prompt: string;
  /** Dossier du projet : l'agent y travaille. */
  dossier: string | null;
  /** Session à reprendre : l'agent se souvient de la conversation. */
  sessionId: string | null;
  /** Modèle choisi dans la conversation (« opus », « sonnet », « haiku »), ou null : celui de la fiche. */
  modele?: string | null;
  /** Effort de réflexion : low, medium, high, xhigh, max ; null : celui par défaut. */
  effort?: string | null;
  /** Fichiers joints au message : leurs dossiers sont ouverts en lecture à l'agent. */
  fichiers?: string[];
}

/** Commandes qu'un agent peut lancer sans demander : construire, vérifier, lire l'état git. */
const COMMANDES_AUTORISEES = [
  "Bash(pnpm:*)",
  "Bash(npx tsc:*)",
  "Bash(npx eslint:*)",
  "Bash(node:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git branch:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(grep:*)",
  "Bash(find:*)",
  "Bash(wc:*)",
];

/** Hors projet (message direct), l'agent travaille dans un dossier à lui, jamais dans tout le dossier personnel. */
const ATELIER = path.join(HOME, ".klyra", "atelier");

/** `~/…` → chemin absolu. null si le dossier du projet n'existe pas. */
function dossierDeTravail(dossier: string | null): string | null {
  if (!dossier) {
    mkdirSync(ATELIER, { recursive: true });
    return ATELIER;
  }
  const absolu = dossier.startsWith("~") ? path.join(HOME, dossier.slice(1)) : dossier;
  return existsSync(absolu) ? absolu : null;
}

export function dossierExiste(dossier: string): boolean {
  const absolu = dossier.startsWith("~") ? path.join(HOME, dossier.slice(1)) : dossier;
  return existsSync(absolu);
}

/**
 * Lance un agent dans le dossier du projet (fichiers en lecture et écriture,
 * commandes de la liste ci-dessus), et transmet sa réponse au fil de l'eau.
 * Se termine toujours par un événement `fin`.
 */
export function streamAgent(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void): void {
  const fin = (event: Extract<AgentEvent, { type: "fin" }>) => emit(event);
  const bin = findClaude();
  if (!bin) return fin({ type: "fin", ok: false, texte: "", erreur: "Claude Code est introuvable sur ce poste." });
  if (options.agent !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.agent)) {
    return fin({ type: "fin", ok: false, texte: "", erreur: "Nom d’agent invalide." });
  }
  if (options.sessionId !== null && !/^[0-9a-f-]{36}$/.test(options.sessionId)) {
    return fin({ type: "fin", ok: false, texte: "", erreur: "Session invalide." });
  }

  const cwd = dossierDeTravail(options.dossier);
  if (!cwd) return fin({ type: "fin", ok: false, texte: "", erreur: `Le dossier du projet est introuvable : ${options.dossier}` });

  /* Accès de travail : les fichiers du dossier en lecture et en écriture
     (acceptEdits, limité à ce dossier), et seulement les commandes de la
     liste. Tout le reste est refusé d'office. */
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ...COMMANDES_AUTORISEES,
  ];
  if (options.agent) args.push("--agent", options.agent);
  if (options.sessionId) args.push("--resume", options.sessionId);
  if (options.modele) {
    if (!/^[a-z0-9][a-z0-9.\-]{0,63}$/.test(options.modele)) {
      return fin({ type: "fin", ok: false, texte: "", erreur: "Modèle invalide." });
    }
    args.push("--model", options.modele);
  }
  if (options.effort) {
    if (!["low", "medium", "high", "xhigh", "max"].includes(options.effort)) {
      return fin({ type: "fin", ok: false, texte: "", erreur: "Effort invalide." });
    }
    args.push("--effort", options.effort);
  }
  // Les dossiers des pièces jointes, pour que l'agent puisse les lire.
  const dossiersJoints = [...new Set((options.fichiers ?? []).filter((f) => path.isAbsolute(f) && existsSync(f)).map((f) => path.dirname(f)))];
  for (const d of dossiersJoints) if (!d.startsWith(cwd)) args.push("--add-dir", d);

  const child = spawn(bin, args, {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  running.set(requestId, child);

  let tampon = "";
  let stderr = "";
  let resultat: Extract<AgentEvent, { type: "fin" }> | null = null;
  /* Le texte d'un nouveau message après des étapes commence un nouveau bloc. */
  let etapesDepuisTexte = false;
  let dejaDuTexte = false;

  const lireLigne = (ligne: string) => {
    if (!ligne.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ligne) as Record<string, unknown>;
    } catch {
      return;
    }
    const parent = (msg.parent_tool_use_id as string | null | undefined) ?? null;

    if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
      emit({ type: "session", sessionId: msg.session_id });
      return;
    }
    if (msg.type === "rate_limit_event") {
      noterUtilisation(msg.rate_limit_info);
      return;
    }
    if (msg.type === "stream_event" && parent === null) {
      const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } };
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        emit({ type: "texte", delta: ev.delta.text, nouveauBloc: dejaDuTexte && etapesDepuisTexte });
        etapesDepuisTexte = false;
        dejaDuTexte = true;
      }
      return;
    }
    if (msg.type === "assistant") {
      const contenu = ((msg.message as { content?: unknown[] })?.content ?? []) as {
        type: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }[];
      for (const bloc of contenu) {
        if (bloc.type === "tool_use" && bloc.id && bloc.name) {
          emit({ type: "etape", id: bloc.id, outil: bloc.name, entree: bloc.input ?? {}, parent });
          if (parent === null) etapesDepuisTexte = true;
        }
      }
      return;
    }
    if (msg.type === "user") {
      const contenu = ((msg.message as { content?: unknown[] })?.content ?? []) as {
        type: string;
        tool_use_id?: string;
        is_error?: boolean;
        content?: unknown;
      }[];
      for (const bloc of contenu) {
        if (bloc.type !== "tool_result" || !bloc.tool_use_id) continue;
        const brut = typeof bloc.content === "string" ? bloc.content : JSON.stringify(bloc.content ?? "");
        emit({ type: "etape-fin", id: bloc.tool_use_id, ok: !bloc.is_error, apercu: brut.slice(0, 400) });
      }
      return;
    }
    if (msg.type === "result") {
      const ok = !msg.is_error && msg.subtype === "success";
      resultat = {
        type: "fin",
        ok,
        texte: typeof msg.result === "string" ? msg.result : "",
        erreur: ok ? undefined : (typeof msg.result === "string" && msg.result) || "L’agent s’est arrêté sur une erreur.",
        costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
        sessionId: typeof msg.session_id === "string" ? msg.session_id : undefined,
      };
    }
  };

  child.stdout.on("data", (d: Buffer) => {
    tampon += d.toString();
    const lignes = tampon.split("\n");
    tampon = lignes.pop() ?? "";
    lignes.forEach(lireLigne);
  });
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const timeout = setTimeout(() => child.kill("SIGTERM"), 60 * 60 * 1000);

  child.on("error", (error) => {
    clearTimeout(timeout);
    running.delete(requestId);
    fin({ type: "fin", ok: false, texte: "", erreur: `Impossible de lancer Claude Code : ${error.message}` });
  });
  child.on("close", (code, signal) => {
    clearTimeout(timeout);
    running.delete(requestId);
    lireLigne(tampon);
    if (signal) return fin({ type: "fin", ok: false, texte: "", erreur: "Arrêté." });
    fin(
      resultat ?? {
        type: "fin",
        ok: false,
        texte: "",
        erreur: stderr.trim().slice(0, 600) || `Claude Code s’est arrêté (code ${code}).`,
      },
    );
  });

  child.stdin.end(options.prompt);
}

/* ─── Utilisation de Claude ────────────────────────────────────── */

/** Une fenêtre de limite : la part utilisée (0 à 1) et quand elle repart à zéro. */
export interface FenetreUtilisation {
  utilise: number;
  /** Date de remise à zéro, en millisecondes. */
  reinitialiseA: number | null;
}

/** L'utilisation de l'abonnement Claude, telle que Claude Code la renvoie à chaque réponse. */
export interface Utilisation {
  /** Fenêtre de 5 h. */
  session: FenetreUtilisation | null;
  /** Fenêtre de 7 jours. */
  semaine: FenetreUtilisation | null;
  /** « allowed », « allowed_warning » ou « rejected » (limite atteinte). */
  statut: string;
  misAJour: number;
}

let derniere: Utilisation | null = null;
const abonnes = new Set<(u: Utilisation) => void>();

export function derniereUtilisation(): Utilisation | null {
  return derniere;
}

/** Reprend la dernière utilisation connue (gardée sur le disque par le process principal). */
export function restaurerUtilisation(u: Utilisation | null): void {
  if (u && (!derniere || u.misAJour > derniere.misAJour)) derniere = u;
}

export function surUtilisation(callback: (u: Utilisation) => void): () => void {
  abonnes.add(callback);
  return () => abonnes.delete(callback);
}

function fenetre(brut: unknown): FenetreUtilisation | null {
  const f = brut as { utilization?: unknown; resetsAt?: unknown } | undefined;
  if (!f || typeof f.utilization !== "number") return null;
  return { utilise: f.utilization, reinitialiseA: typeof f.resetsAt === "number" ? f.resetsAt * 1000 : null };
}

function noterUtilisation(info: unknown): void {
  const i = info as { status?: unknown; unifiedWindows?: Record<string, unknown> } | undefined;
  if (!i) return;
  derniere = {
    session: fenetre(i.unifiedWindows?.five_hour),
    semaine: fenetre(i.unifiedWindows?.seven_day),
    statut: typeof i.status === "string" ? i.status : "allowed",
    misAJour: Date.now(),
  };
  abonnes.forEach((cb) => cb(derniere!));
}

/**
 * Demande l'utilisation à jour par une toute petite requête (modèle le plus
 * léger, sans outil, sans garder de session). Elle compte, très peu, dans
 * l'utilisation : on ne la lance qu'à la demande.
 */
export function actualiserUtilisation(): Promise<Utilisation | null> {
  const bin = findClaude();
  if (!bin) return Promise.resolve(derniere);
  mkdirSync(ATELIER, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      ["-p", "--model", "haiku", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--disallowedTools", ...OUTILS_INTERDITS, "WebFetch", "WebSearch", "Read", "Glob", "Grep"],
      { cwd: ATELIER, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } },
    );
    let tampon = "";
    child.stdout.on("data", (d: Buffer) => {
      tampon += d.toString();
      const lignes = tampon.split("\n");
      tampon = lignes.pop() ?? "";
      for (const ligne of lignes) {
        try {
          const msg = JSON.parse(ligne) as { type?: string; rate_limit_info?: unknown };
          if (msg.type === "rate_limit_event") noterUtilisation(msg.rate_limit_info);
        } catch {
          /* ligne incomplète */
        }
      }
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 60_000);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(derniere);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      resolve(derniere);
    });
    child.stdin.end("Réponds seulement : ok");
  });
}
