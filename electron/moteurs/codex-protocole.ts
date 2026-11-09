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

/**
 * Ce que Codex appelle sans demander, parmi les outils MCP : tout en accès complet, sinon la liste des outils
 * libres (`mcp__serveur__outil`, les mêmes que l'`--allowedTools` de Claude Code), rien en accès « Demander ».
 */
export type OutilsLibres = "tout" | readonly string[];

/** Les outils libres pour un accès : `tout` en accès complet, `libres` en accès « Projet », aucun en accès « Demander ». */
export function outilsLibresCodex(acces: Acces, libres: () => readonly string[]): OutilsLibres {
  return acces === "tout" ? "tout" : acces === "projet" ? libres() : [];
}

/**
 * Les serveurs MCP de l'app (format `--mcp-config` de Claude Code, cf. ia.ts) en `mcp_servers` de Codex.
 * Codex demande l'accord avant chaque appel d'outil MCP (`mcpServer/elicitation/request`), et le refuse
 * en accès complet (« approval policy is never ») : les outils libres sont approuvés d'avance
 * (`default_tools_approval_mode`, ou `tools.<outil>.approval_mode`), les autres passent par une carte.
 * Vérifié avec Codex 0.166.
 */
export function mcpPourCodex(config: string | null, libres: OutilsLibres = []): Record<string, Record<string, unknown>> {
  if (!config) return {};
  const { mcpServers = {} } = JSON.parse(config) as { mcpServers?: Record<string, ServeurMcp> };
  return Object.fromEntries(
    Object.entries(mcpServers).map(([nom, s]) => {
      const prefixe = `mcp__${nom}__`;
      const outils = libres === "tout" ? [] : [...new Set(libres.filter((o) => o.startsWith(prefixe) && o.length > prefixe.length).map((o) => o.slice(prefixe.length)))];
      return [
        nom,
        {
          ...(s.url ? { url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) } : { command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) }),
          ...(libres === "tout" ? { default_tools_approval_mode: "approve" } : {}),
          ...(outils.length ? { tools: Object.fromEntries(outils.map((o) => [o, { approval_mode: "approve" }])) } : {}),
        },
      ];
    }),
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

/** Une demande de Codex qui attend ta réponse, en carte d'autorisation ; null pour celles que l'app refuse d'office. */
export function autorisationDe(method: string, params: Record<string, unknown>): { outil: string; entree: Record<string, unknown>; description: string } | null {
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const commande = typeof params.command === "string" ? params.command : "";
      return { outil: "Bash", entree: { command: commande }, description: String(params.reason ?? commande) || "Lancer une commande" };
    }
    case "item/fileChange/requestApproval":
      return { outil: "Edit", entree: { file_path: params.grantRoot ?? "" }, description: String(params.reason ?? "") || "Modifier des fichiers" };
    case "item/permissions/requestApproval":
      return { outil: "Permissions", entree: { permissions: params.permissions }, description: String(params.reason ?? "") || "Plus d’accès (réseau ou fichiers)" };
    case "mcpServer/elicitation/request": {
      const meta = accordOutilMcp(params);
      if (!meta) return null;
      const serveur = String(params.serverName ?? "");
      const outil = outilDeLaDemande(params.message);
      const entree = meta.tool_params && typeof meta.tool_params === "object" && !Array.isArray(meta.tool_params) ? (meta.tool_params as Record<string, unknown>) : {};
      const description = typeof meta.tool_description === "string" && meta.tool_description ? meta.tool_description : `Utiliser un outil de ${serveur}`;
      return { outil: outil ? `mcp__${serveur}__${outil}` : `mcp__${serveur}`, entree, description };
    }
    default:
      return null;
  }
}

/**
 * La demande d'accord avant un appel d'outil MCP : Codex la pose en formulaire MCP (« elicitation »),
 * marquée `_meta.codex_approval_kind`. Les autres formulaires d'un serveur MCP restent refusés d'office.
 */
function accordOutilMcp(params: Record<string, unknown>): Record<string, unknown> | null {
  const meta = params._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return (meta as Record<string, unknown>).codex_approval_kind === "mcp_tool_call" ? (meta as Record<string, unknown>) : null;
}

/** Le nom de l'outil, que Codex ne donne que dans sa question (« Allow the klyra MCP server to run tool "lire" ? »). */
function outilDeLaDemande(message: unknown): string | null {
  const m = typeof message === "string" ? /run tool "([^"]{1,128})"/.exec(message) : null;
  return m ? m[1] : null;
}

/** La réponse à envoyer à Codex pour une demande d'autorisation. */
export function reponseAutorisation(method: string, params: Record<string, unknown>, decision: Decision): Record<string, unknown> {
  if (method === "item/permissions/requestApproval") {
    return decision === "non"
      ? { permissions: {}, scope: "turn" }
      : { permissions: params.permissions ?? {}, scope: decision === "toujours" ? "session" : "turn" };
  }
  if (method === "mcpServer/elicitation/request") {
    if (decision === "non") return { action: "decline", content: null, _meta: null };
    // « Toujours » : pour la session seulement (jamais `always`, que Codex écrirait dans sa configuration).
    const persist = (accordOutilMcp(params)?.persist as unknown[] | undefined) ?? [];
    return { action: "accept", content: {}, _meta: decision === "toujours" && Array.isArray(persist) && persist.includes("session") ? { persist: "session" } : null };
  }
  return { decision: decisionCodex(decision) };
}

/**
 * Ce que l'app répond d'office aux demandes qu'elle ne sait pas montrer : questions en cours de route
 * (l'agent les pose dans sa réponse, comme à un collègue), formulaires MCP (sauf l'accord avant un appel
 * d'outil, qui devient une carte : `autorisationDe`), outils du client.
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
