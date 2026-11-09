import type { AgentEvent, Decision, StreamOptions } from "./types";

/**
 * Ce que l'app dit à Codex (`codex app-server`, JSON-RPC sur stdio) et ce qu'elle lit de lui,
 * sans processus ni Electron : la partie que les tests rejouent (cf. registre.test.mts).
 * Protocole lu dans `codex app-server generate-ts`, Codex 0.164.
 */

type Acces = NonNullable<StreamOptions["acces"]>;

/** Les trois accès de l'app, dans les mots de Codex : quand il demande, et ce que son bac à sable laisse faire. */
export function accesCodex(acces: Acces) {
  switch (acces) {
    case "demander":
      return { approvalPolicy: "untrusted", sandbox: "read-only", sandboxPolicy: { type: "readOnly", networkAccess: false } } as const;
    case "projet":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      } as const;
    case "tout":
      return { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } } as const;
  }
}

type ServeurMcp = { type?: string; url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> };

/** Les serveurs MCP de l'app (format `--mcp-config` de Claude Code, cf. ia.ts) en `mcp_servers` de Codex. */
export function mcpPourCodex(config: string | null): Record<string, Record<string, unknown>> {
  if (!config) return {};
  const { mcpServers = {} } = JSON.parse(config) as { mcpServers?: Record<string, ServeurMcp> };
  return Object.fromEntries(
    Object.entries(mcpServers).map(([nom, s]) => [
      nom,
      s.url
        ? { url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) }
        : { command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) },
    ]),
  );
}

/** La fiche d'un agent sans son en-tête YAML : ce qui devient sa consigne. */
export function corpsDeFiche(contenu: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(contenu);
  return (m ? contenu.slice(m[0].length) : contenu).trim();
}

/** Ta réponse à une demande d'autorisation, dans les mots de Codex. */
export function decisionCodex(decision: Decision): "accept" | "acceptForSession" | "decline" {
  return decision === "oui" ? "accept" : decision === "toujours" ? "acceptForSession" : "decline";
}

const APERCU = 600;
const court = (texte: string) => (texte.length > APERCU ? `${texte.slice(0, APERCU)}…` : texte);

type Item = Record<string, unknown> & { type: string; id: string };

/** Une étape de l'app pour un élément de Codex ; null pour ce qui n'en est pas une (texte, réflexion…). */
export function etapeDe(item: Item): { outil: string; entree: Record<string, unknown> } | null {
  switch (item.type) {
    case "commandExecution":
      return { outil: "Bash", entree: { command: item.command } };
    case "fileChange": {
      const changes = (item.changes as { path: string; kind: unknown }[] | undefined) ?? [];
      return { outil: "Edit", entree: { file_path: changes[0]?.path ?? "", fichiers: changes.map((c) => c.path) } };
    }
    case "mcpToolCall":
      return { outil: `mcp__${String(item.server)}__${String(item.tool)}`, entree: (item.arguments as Record<string, unknown>) ?? {} };
    case "dynamicToolCall":
      return { outil: String(item.tool), entree: (item.arguments as Record<string, unknown>) ?? {} };
    case "webSearch":
      return { outil: "WebSearch", entree: { query: item.query ?? "" } };
    case "imageView":
      return { outil: "Read", entree: { file_path: item.path } };
    default:
      return null;
  }
}

/** Comment l'étape s'est terminée, et ce qu'on en montre. */
export function finDEtape(item: Item): { ok: boolean; apercu: string } {
  switch (item.type) {
    case "commandExecution":
      return { ok: item.status === "completed" && (item.exitCode ?? 0) === 0, apercu: court(String(item.aggregatedOutput ?? "").trim()) };
    case "fileChange":
      return { ok: item.status === "completed", apercu: item.status === "declined" ? "Refusé." : "" };
    case "mcpToolCall": {
      const erreur = (item.error as { message?: string } | null)?.message;
      const contenu = ((item.result as { content?: { type?: string; text?: string }[] } | null)?.content ?? [])
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n");
      return { ok: item.status === "completed" && !erreur, apercu: court((erreur ?? contenu).trim()) };
    }
    default:
      return { ok: item.status !== "failed" && item.status !== "declined", apercu: "" };
  }
}

/**
 * Une réponse de Codex (un « tour »), traduite au fil de l'eau en `AgentEvent`.
 * `notification` rend true quand le tour est fini : son `fin` est parti.
 */
export class TourCodex {
  private etapes = new Set<string>();
  private etapesDepuisTexte = false;
  private dejaDuTexte = false;
  private dernierTexte = "";
  /** Tu l'as arrêté : sa fin le dit. */
  arrete = false;
  /** Le tour de Codex qui porte cette réponse, connu à `turn/started`. */
  turnId: string | null = null;
  /** Les jetons écrits dans tout le fil de Codex, réflexion comprise. */
  jetonsDuFil: number;
  private readonly threadId: string;
  private readonly emit: (event: AgentEvent) => void;
  private readonly jetonsAvant: number;

  /** `jetonsAvant` : ceux du fil avant ce tour (Codex compte le fil entier, l'app compte la réponse). */
  constructor(threadId: string, emit: (event: AgentEvent) => void, jetonsAvant = 0) {
    this.threadId = threadId;
    this.emit = emit;
    this.jetonsAvant = jetonsAvant;
    this.jetonsDuFil = jetonsAvant;
  }

  notification(method: string, params: Record<string, unknown>): boolean {
    switch (method) {
      case "turn/started":
        this.turnId = String((params.turn as { id: string }).id);
        return false;
      case "item/agentMessage/delta": {
        const delta = String(params.delta ?? "");
        if (!delta) return false;
        this.emit({ type: "texte", delta, nouveauBloc: this.dejaDuTexte && this.etapesDepuisTexte });
        this.dejaDuTexte = true;
        this.etapesDepuisTexte = false;
        return false;
      }
      case "item/started": {
        const item = params.item as Item;
        const etape = etapeDe(item);
        if (!etape) return false;
        this.etapes.add(item.id);
        this.etapesDepuisTexte = true;
        this.emit({ type: "etape", id: item.id, outil: etape.outil, entree: etape.entree, parent: null });
        return false;
      }
      case "item/completed": {
        const item = params.item as Item;
        if (item.type === "agentMessage" && typeof item.text === "string" && item.text) this.dernierTexte = item.text;
        if (!this.etapes.delete(item.id)) return false;
        this.emit({ type: "etape-fin", id: item.id, ...finDEtape(item) });
        return false;
      }
      case "thread/tokenUsage/updated": {
        const total = (params.tokenUsage as { total?: { outputTokens?: number; reasoningOutputTokens?: number } }).total;
        if (!total) return false;
        this.jetonsDuFil = (total.outputTokens ?? 0) + (total.reasoningOutputTokens ?? 0);
        this.emit({ type: "jetons", total: Math.max(0, this.jetonsDuFil - this.jetonsAvant) });
        return false;
      }
      case "turn/completed": {
        const turn = params.turn as { status: string; error: { message?: string } | null };
        const ok = turn.status === "completed" && !this.arrete;
        this.emit({
          type: "fin",
          ok,
          texte: this.dernierTexte,
          erreur: ok ? undefined : this.arrete || turn.status === "interrupted" ? "Arrêté par toi." : turn.error?.message || "L’agent s’est arrêté sur une erreur.",
          sessionId: this.threadId,
        });
        return true;
      }
      default:
        return false;
    }
  }
}

/* ─── L'accord pour un outil MCP ───────────────────────────────── */

/*
 * Hors accès complet, Codex demande ton accord avant chaque outil MCP qui ne se dit pas en lecture seule
 * (Composio, la plupart des outils de l'app). Il le demande par un formulaire MCP marqué
 * `_meta.codex_approval_kind = "mcp_tool_call"` (`mcpServer/elicitation/request`), ou, si cette voie
 * est coupée chez lui, par une question `item/tool/requestUserInput` dont l'id commence par
 * `mcp_tool_call_approval`. Refuser ce formulaire d'office, c'était refuser chaque appel
 * (« user rejected MCP tool call »). Lu dans le code de Codex 0.167 (`core/src/mcp_tool_call.rs`,
 * `protocol/src/mcp_approval_meta.rs`).
 */
const ACCORD_MCP = "mcp_tool_call";
const QUESTION_ACCORD_MCP = "mcp_tool_call_approval";
/** Les réponses que Codex reconnaît à sa question (elles ne se traduisent pas). */
const REPONSES_ACCORD_MCP = { oui: "Allow", toujours: "Allow for this session", non: "Cancel" } as const;

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const texte = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Le formulaire de Codex est-il une demande d'accord pour un outil MCP ? */
export function estAccordMcp(params: Record<string, unknown>): boolean {
  return objet(params._meta).codex_approval_kind === ACCORD_MCP;
}

/** La question de Codex qui demande l'accord pour un outil MCP, s'il y en a une. */
function questionAccordMcp(params: Record<string, unknown>): { id: string; question: string; options: string[] } | null {
  const questions = Array.isArray(params.questions) ? params.questions.map(objet) : [];
  const q = questions.find((x) => texte(x.id).startsWith(QUESTION_ACCORD_MCP));
  if (!q) return null;
  const options = Array.isArray(q.options) ? q.options.map((o) => texte(objet(o).label)).filter(Boolean) : [];
  return { id: texte(q.id), question: texte(q.question), options };
}

/** La carte d'un outil MCP : son nom comme pour Claude Code (`mcp__serveur__outil`), et ce qu'il recevra. */
function carteOutilMcp(serveur: string, outil: string, titre: string, entree: Record<string, unknown>) {
  const nom = titre || outil || "un outil";
  return {
    outil: serveur && outil ? `mcp__${serveur}__${outil}` : "MCP",
    entree,
    description: serveur ? `Utiliser « ${nom} » (${serveur})` : `Utiliser « ${nom} »`,
  };
}

/** Une demande de Codex qui attend ta réponse, en carte d'autorisation ; null pour celles que l'app refuse d'office. */
export function autorisationDe(method: string, params: Record<string, unknown>): { outil: string; entree: Record<string, unknown>; description: string } | null {
  switch (method) {
    case "mcpServer/elicitation/request": {
      if (!estAccordMcp(params)) return null;
      const meta = objet(params._meta);
      return carteOutilMcp(texte(params.serverName), texte(meta.tool_name), texte(meta.tool_title), objet(meta.tool_params));
    }
    case "item/tool/requestUserInput": {
      const q = questionAccordMcp(params);
      if (!q) return null;
      // Sans formulaire, Codex ne donne que sa phrase : « Allow the composio MCP server to run tool "X"? ».
      const lu = /the (.+?) MCP server to run tool "(.+)"\?$/.exec(q.question) ?? /to run tool "(.+)"\?$/.exec(q.question);
      return lu?.length === 3 ? carteOutilMcp(lu[1], lu[2], "", {}) : carteOutilMcp("", lu?.[1] ?? "", "", {});
    }
    case "item/commandExecution/requestApproval": {
      const commande = typeof params.command === "string" ? params.command : "";
      return { outil: "Bash", entree: { command: commande }, description: String(params.reason ?? commande) || "Lancer une commande" };
    }
    case "item/fileChange/requestApproval":
      return { outil: "Edit", entree: { file_path: params.grantRoot ?? "" }, description: String(params.reason ?? "") || "Modifier des fichiers" };
    case "item/permissions/requestApproval":
      return { outil: "Permissions", entree: { permissions: params.permissions }, description: String(params.reason ?? "") || "Plus d’accès (réseau ou fichiers)" };
    default:
      return null;
  }
}

/**
 * Une carte accordée sans te la montrer : tout en accès complet ; en accès « projet », les outils de l'app
 * que Claude Code reçoit sans demander (`libres`, cf. `OUTILS_APP`). Le reste attend ta réponse.
 */
export function accordeDOffice(acces: Acces, outil: string, libres: readonly string[]): boolean {
  return acces === "tout" || (acces === "projet" && libres.includes(outil));
}

/** La réponse à envoyer à Codex pour une demande d'autorisation. */
export function reponseAutorisation(method: string, params: Record<string, unknown>, decision: Decision): Record<string, unknown> {
  if (method === "item/permissions/requestApproval") {
    return decision === "non"
      ? { permissions: {}, scope: "turn" }
      : { permissions: params.permissions ?? {}, scope: decision === "toujours" ? "session" : "turn" };
  }
  if (method === "mcpServer/elicitation/request") {
    // « Toujours » : pour cet outil, le temps de la session de Codex (`persist`), rien d'écrit dans sa configuration.
    if (decision === "non") return { action: "decline", content: null, _meta: null };
    return { action: "accept", content: null, _meta: decision === "toujours" ? { persist: "session" } : null };
  }
  if (method === "item/tool/requestUserInput") {
    const q = questionAccordMcp(params);
    if (!q) return { answers: {} };
    const voulue = REPONSES_ACCORD_MCP[decision];
    // « Pour cette session » n'est pas toujours proposé : un simple accord à la place.
    const reponse = q.options.length && !q.options.includes(voulue) ? REPONSES_ACCORD_MCP.oui : voulue;
    return { answers: { [q.id]: { answers: [reponse] } } };
  }
  return { decision: decisionCodex(decision) };
}

/**
 * Ce que l'app répond d'office aux demandes qu'elle ne sait pas montrer : questions en cours de route
 * (l'agent les pose dans sa réponse, comme à un collègue), formulaires MCP, outils du client.
 */
export function reponseDOffice(method: string): { result: unknown } | { error: { code: number; message: string } } {
  switch (method) {
    case "item/tool/requestUserInput":
      return { result: { answers: {} } };
    case "mcpServer/elicitation/request":
      return { result: { action: "decline", content: null, _meta: null } };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { result: { decision: "denied" } };
    default:
      return { error: { code: -32601, message: `KLYRA ne gère pas « ${method} ».` } };
  }
}
