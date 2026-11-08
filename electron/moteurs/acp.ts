import { spawn, type ChildProcess } from "node:child_process";
import type { AgentEvent, Decision, ModeleMoteur, StreamOptions } from "./types";

/**
 * Grok, par Grok Build (`grok agent stdio`) : l'Agent Client Protocol (ACP, agentclientprotocol.com),
 * JSON-RPC sur stdio. Ce module n'a ni Electron ni chemin du poste : le PC (electron/moteurs/grok.ts)
 * et le VPS (`serveur/acp.mjs`, généré par scripts/serveur-genere.mjs, lu par serveur/grok.mjs) lancent
 * le même client et ne lui donnent que ce qui change d'une machine à l'autre (programme, environnement,
 * consignes, serveurs MCP).
 *
 * Lu dans la documentation embarquée de Grok Build 1.0.70 (« Agent Mode », « Permissions and Safety »,
 * « Sessions ») : `session/new` prend `_meta.rules` (ajouté au prompt système) et `_meta.yoloMode`
 * (accès complet) ; le modèle et l'effort passent par `session/set_config_option` (`model`,
 * `reasoning_effort`, valeur `{ value }`) ; un outil MCP s'appelle `serveur__outil`.
 */

type Json = Record<string, unknown>;
type Acces = NonNullable<StreamOptions["acces"]>;

/* ─── Ce que l'app dit à Grok ──────────────────────────────────── */

/** Un serveur MCP dans la forme d'ACP (`session/new`, `session/load`). */
export type McpAcp =
  | { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
  | { type: "http"; name: string; url: string; headers: { name: string; value: string }[] };

type ServeurMcp = { type?: string; url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> };

/** Les serveurs MCP de l'app (format `--mcp-config` de Claude Code, cf. ia.ts) dans la forme d'ACP. */
export function mcpPourAcp(config: string | null): McpAcp[] {
  if (!config) return [];
  const { mcpServers = {} } = JSON.parse(config) as { mcpServers?: Record<string, ServeurMcp> };
  const paires = (o: Record<string, string> | undefined) => Object.entries(o ?? {}).map(([name, value]) => ({ name, value: String(value) }));
  return Object.entries(mcpServers).map(([name, s]) =>
    s.url ? { type: "http", name, url: s.url, headers: paires(s.headers) } : { name, command: String(s.command ?? ""), args: s.args ?? [], env: paires(s.env) },
  );
}

/**
 * Les variables qui gardent Grok dans ce que l'app lui donne (« Harness compatibility ») : ni les skills ni les serveurs MCP de
 * Claude Code (la personne choisit les skills de chaque agent dans Réglages › Agents, et l'app sert les
 * siens). Les CLAUDE.md et les règles restent lus, comme dans une session de Claude Code.
 */
export const ENV_GROK: Record<string, string> = {
  /* KLYRA met à jour le Grok qu'il a installé (Réglages du serveur › Fournisseurs). */
  GROK_DISABLE_AUTOUPDATER: "1",
  GROK_CLAUDE_SKILLS_ENABLED: "false",
  GROK_CLAUDE_MCPS_ENABLED: "false",
  GROK_CURSOR_SKILLS_ENABLED: "false",
  GROK_CURSOR_MCPS_ENABLED: "false",
};

/** Les modes de Grok pour chaque accès de l'app, du préféré au repli (« Permission modes »). */
const MODES: Record<Acces, string[]> = {
  demander: ["default", "ask"],
  projet: ["acceptEdits", "accept-edits"],
  tout: ["bypassPermissions", "always-approve", "yolo"],
};

/** Le mode de la session à poser pour cet accès, parmi ceux qu'elle annonce ; null s'il n'y est pas (ou s'il l'est déjà). */
export function modePour(acces: Acces, disponibles: string[], courant: string | null): string | null {
  const voulu = MODES[acces].find((m) => disponibles.includes(m)) ?? null;
  return voulu && voulu !== courant ? voulu : null;
}

/* ─── Les options d'une session (modèle, effort) ───────────────── */

type ValeurOption = { value?: unknown; name?: unknown; description?: unknown; options?: unknown };
type OptionConfig = { id?: unknown; configId?: unknown; category?: unknown; currentValue?: unknown; options?: unknown };

function valeurs(options: unknown): { value: string; name: string }[] {
  if (!Array.isArray(options)) return [];
  return (options as ValeurOption[]).flatMap((o) => {
    if (Array.isArray(o.options)) return valeurs(o.options); // un groupe d'options
    return typeof o.value === "string" ? [{ value: o.value, name: typeof o.name === "string" && o.name ? o.name : o.value }] : [];
  });
}

/** Ce que disent les `configOptions` d'une session : les modèles, les efforts, et ce qui est choisi. */
export function lireOptions(configOptions: unknown): { modeles: ModeleMoteur[]; modele: string | null; effort: string | null } {
  const liste = Array.isArray(configOptions) ? (configOptions as OptionConfig[]) : [];
  const trouve = (id: string, categorie: string) => liste.find((o) => o.id === id || o.configId === id || o.category === categorie);
  const modele = trouve("model", "model");
  const effort = trouve("reasoning_effort", "thought_level");
  const efforts = valeurs(effort?.options).map((v) => v.value);
  const courantModele = typeof modele?.currentValue === "string" ? modele.currentValue : null;
  const courantEffort = typeof effort?.currentValue === "string" ? effort.currentValue : null;
  return {
    modeles: valeurs(modele?.options).map((v) => ({ id: v.value, nom: v.name, efforts, effortParDefaut: courantEffort, parDefaut: v.value === courantModele })),
    modele: courantModele,
    effort: courantEffort,
  };
}

/* ─── Ce que Grok répond, en événements de l'app ───────────────── */

const APERCU = 600;
const court = (texte: string) => (texte.length > APERCU ? `${texte.slice(0, APERCU)}…` : texte);
const OUTIL_MCP = /^(?:mcp__)?([A-Za-z_][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+)*)__([A-Za-z0-9_-]+)$/;

type AppelOutil = Json & { toolCallId?: unknown; title?: unknown; kind?: unknown; status?: unknown; rawInput?: unknown; rawOutput?: unknown; content?: unknown; locations?: unknown; _meta?: unknown };

const objet = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** Une étape de l'app pour un appel d'outil d'ACP. Un outil MCP (`serveur__outil`) garde le nom que l'app connaît (`mcp__serveur__outil`). */
export function etapeAcp(appel: AppelOutil): { outil: string; entree: Json } {
  const entree = objet(appel.rawInput);
  const meta = objet(appel._meta);
  const titre = typeof appel.title === "string" ? appel.title : "";
  const noms = [entree.name, entree.tool_name, entree.toolName, meta.toolName, meta.tool_name, objet(meta["x.ai"]).toolName, titre].filter((n): n is string => typeof n === "string");
  for (const nom of noms) {
    const m = OUTIL_MCP.exec(nom.trim());
    if (m) return { outil: `mcp__${m[1]}__${m[2]}`, entree: objet(entree.arguments ?? entree.args ?? entree.input ?? entree) };
  }
  const chemin = (Array.isArray(appel.locations) ? (appel.locations as { path?: unknown }[]) : []).map((l) => l.path).find((p): p is string => typeof p === "string") ?? "";
  switch (appel.kind) {
    case "execute":
      return { outil: "Bash", entree: { command: typeof entree.command === "string" ? entree.command : titre, ...entree } };
    case "read":
      return { outil: "Read", entree: { file_path: chemin || entree.path || entree.file_path || titre, ...entree } };
    case "edit":
    case "delete":
    case "move":
      return { outil: "Edit", entree: { file_path: chemin || entree.path || entree.file_path || titre, ...entree } };
    case "search":
      return { outil: "Grep", entree: { pattern: entree.pattern ?? entree.query ?? titre, ...entree } };
    case "fetch":
      return { outil: "WebFetch", entree: { url: entree.url ?? titre, ...entree } };
    default:
      return { outil: titre || "Outil", entree };
  }
}

/** Le texte d'un contenu d'ACP (bloc, liste de blocs, ou contenu d'appel d'outil). */
function texteDe(contenu: unknown): string {
  if (typeof contenu === "string") return contenu;
  if (Array.isArray(contenu)) return contenu.map(texteDe).filter(Boolean).join("\n");
  const c = objet(contenu);
  if (c.type === "text" && typeof c.text === "string") return c.text;
  if (c.type === "content") return texteDe(c.content);
  if (c.type === "diff" && typeof c.path === "string") return c.path;
  return "";
}

/**
 * Une réponse de Grok (un `session/prompt`), traduite au fil de l'eau en `AgentEvent`. `update` reçoit
 * les `session/update` de sa session ; `finir` reçoit la réponse au `session/prompt` (ou son erreur).
 */
export class TourAcp {
  private etapes = new Map<string, boolean>();
  private etapesDepuisTexte = false;
  private dejaDuTexte = false;
  /** Tout le texte, et celui écrit depuis la dernière étape : la réponse de fin. */
  private texte = "";
  private texteFinal = "";
  /** Tu l'as arrêté : sa fin le dit. */
  arrete = false;
  fini = false;
  readonly sessionId: string;
  private readonly emit: (event: AgentEvent) => void;

  constructor(sessionId: string, emit: (event: AgentEvent) => void) {
    this.sessionId = sessionId;
    this.emit = emit;
  }

  update(update: Json): void {
    if (this.fini) return;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const delta = texteDe(update.content);
        if (!delta) return;
        this.emit({ type: "texte", delta, nouveauBloc: this.dejaDuTexte && this.etapesDepuisTexte });
        if (this.etapesDepuisTexte) this.texteFinal = "";
        this.texte += delta;
        this.texteFinal += delta;
        this.dejaDuTexte = true;
        this.etapesDepuisTexte = false;
        return;
      }
      case "tool_call": {
        const id = String(update.toolCallId ?? "");
        if (!id || this.etapes.has(id)) return this.finEtape(update);
        const { outil, entree } = etapeAcp(update as AppelOutil);
        this.etapes.set(id, false);
        this.etapesDepuisTexte = true;
        this.emit({ type: "etape", id, outil, entree, parent: null });
        return this.finEtape(update);
      }
      case "tool_call_update":
        return this.finEtape(update);
      case "usage_update": {
        /* Ce que relit la session (ACP, encore instable) : la taille de la conversation. */
        const utilise = Number(update.used);
        if (Number.isFinite(utilise) && utilise > 0) this.emit({ type: "contexte", jetons: Math.round(utilise) });
        return;
      }
      default:
        return;
    }
  }

  private finEtape(update: Json) {
    const id = String(update.toolCallId ?? "");
    if (!this.etapes.has(id) || this.etapes.get(id)) return;
    if (update.status !== "completed" && update.status !== "failed") return;
    this.etapes.set(id, true);
    const sortie = texteDe(update.content) || (typeof update.rawOutput === "string" ? update.rawOutput : texteDe(objet(update.rawOutput).content));
    this.emit({ type: "etape-fin", id, ok: update.status === "completed", apercu: court(sortie.trim()) });
  }

  /** La fin de la réponse : `stopReason` d'ACP, ou l'erreur du `session/prompt`. */
  finir(resultat: { stopReason?: unknown } | null, erreur?: string): void {
    if (this.fini) return;
    this.fini = true;
    // Les étapes restées ouvertes se ferment avec la réponse.
    for (const [id, close] of this.etapes) if (!close) this.emit({ type: "etape-fin", id, ok: !erreur && !this.arrete, apercu: "" });
    const raison = resultat?.stopReason;
    const arretee = this.arrete || raison === "cancelled";
    const ok = !erreur && !arretee && raison !== "refusal";
    this.emit({
      type: "fin",
      ok,
      texte: (this.texteFinal || this.texte).trim(),
      erreur: ok ? undefined : arretee ? "Arrêté par toi." : erreur || (raison === "refusal" ? "Grok a refusé de répondre." : "L’agent s’est arrêté sur une erreur."),
      sessionId: this.sessionId,
    });
  }
}

/* ─── Les demandes d'autorisation ──────────────────────────────── */

type OptionPermission = { optionId?: unknown; kind?: unknown };

/** Une demande `session/request_permission`, en carte d'autorisation de l'app. */
export function autorisationAcp(params: Json): { outil: string; entree: Json; description: string } {
  const appel = objet(params.toolCall) as AppelOutil;
  const { outil, entree } = etapeAcp(appel);
  const titre = typeof appel.title === "string" ? appel.title : "";
  return { outil, entree, description: titre || (outil === "Bash" ? String(entree.command ?? "Lancer une commande") : "Utiliser un outil") };
}

/** Ta réponse, dans les mots d'ACP : l'option de Grok qui lui correspond (`allow_once`, `allow_always`, `reject_once`). */
export function reponseAutorisationAcp(params: Json, decision: Decision): { outcome: Json } {
  const options = Array.isArray(params.options) ? (params.options as OptionPermission[]) : [];
  const voulues = decision === "non" ? ["reject_once", "reject_always"] : decision === "toujours" ? ["allow_always", "allow_once"] : ["allow_once", "allow_always"];
  for (const kind of voulues) {
    const option = options.find((o) => o.kind === kind && typeof o.optionId === "string");
    if (option) return { outcome: { outcome: "selected", optionId: option.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

/* ─── Le client ────────────────────────────────────────────────── */

const ID_SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ARRET_MAX_MS = 5000;
const FACTURATION_MAX_MS = 15_000;
/** Une requête de mise en place (session, mode, modèle) : Grok qui ne répond pas ne doit pas laisser la réponse « réfléchir » sans fin. */
const DELAI_REQUETE_MS = 90_000;
/** Une réponse sans aucun signe de Grok depuis ce temps est arrêtée (une autorisation en attente ne compte pas). */
const INACTIVITE_MAX_MS = 10 * 60_000;
const VEILLE_PAS_MS = 15_000;

/** Ce que le client demande à la machine qui le lance (le PC ou le VPS). */
export interface OptionsAcp {
  /** Le programme `grok`, ou null s'il n'est pas là. */
  trouver: () => string | null;
  /** L'environnement du processus (clé API comprise s'il y en a une). */
  env: () => Record<string, string | undefined>;
  /** Le dossier où le processus démarre (chaque session donne ensuite le sien). */
  cwd: () => string;
  /** Le nom de l'app pour Grok (`initialize`). */
  client: { name: string; title: string; version: string };
}

/** Une demande de réponse, préparée par la machine : consignes, serveurs MCP, texte. */
export interface TourDemande {
  sessionId: string | null;
  cwd: string;
  prompt: string;
  /** Ajouté au prompt système de la session (fiche, consignes de l'app, skills). */
  regles: string;
  mcp: McpAcp[];
  acces: Acces;
  modele?: string | null;
  effort?: string | null;
  /** Ce qui a configuré la session : changée, la session est rechargée avec les serveurs MCP à jour. */
  signature: string;
}

interface Reponse {
  requestId: string;
  tour: TourAcp;
  acces: Acces;
  emit: (event: AgentEvent) => void;
  demandes: Map<string, { rpcId: number | string; params: Json }>;
  /** Dernier signe de Grok (mise à jour, demande, réponse). */
  derniere: number;
  veille?: ReturnType<typeof setInterval>;
}

interface Session {
  signature: string;
  modes: string[];
  mode: string | null;
  modele: string | null;
  effort: string | null;
}

/** Le client ACP de Grok : un `grok agent stdio` gardé ouvert, une session de Grok par conversation. */
export function creerClientAcp(o: OptionsAcp) {
  let child: ChildProcess | null = null;
  let bin: string | null = null;
  let demarrage: Promise<void> | null = null;
  let suivant = 0;
  let stderr = "";
  let version: string | null = null;
  let modelesConnus: ModeleMoteur[] | null = null;
  const attentes = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const sessions = new Map<string, Session>();
  const enCours = new Map<string, Reponse>();
  const parRequete = new Map<string, string>();

  const ecrire = (message: Json) => child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

  function requete<T>(method: string, params: Json, ms: number = DELAI_REQUETE_MS): Promise<T> {
    if (!child) return Promise.reject(new Error("Grok n’est pas lancé."));
    if (ms > 0) return requeteBornee<T>(method, params, ms);
    const id = ++suivant;
    return new Promise<T>((resolve, reject) => {
      attentes.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ecrire({ id, method, params });
    });
  }

  /** Une requête qui n'attend pas plus de `ms` : une extension que cette version de Grok ne connaît pas ne doit rien bloquer. */
  function requeteBornee<T>(method: string, params: Json, ms: number): Promise<T> {
    if (!child) return Promise.reject(new Error("Grok n’est pas lancé."));
    const id = ++suivant;
    return new Promise<T>((resolve, reject) => {
      const delai = setTimeout(() => {
        attentes.delete(id);
        reject(new Error(`Grok n’a pas répondu à « ${method} » en ${Math.round(ms / 1000)} s. Relance ton message.`));
      }, ms);
      attentes.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(delai);
          resolve(v as T);
        },
        reject: (e: Error) => {
          clearTimeout(delai);
          reject(e);
        },
      });
      ecrire({ id, method, params });
    });
  }

  function arret(processus: ChildProcess, erreur: string) {
    if (child !== processus) return;
    child = null;
    demarrage = null;
    sessions.clear();
    for (const a of attentes.values()) a.reject(new Error(erreur));
    attentes.clear();
    for (const r of enCours.values()) {
      clearInterval(r.veille);
      r.tour.finir(null, erreur);
    }
    enCours.clear();
    parRequete.clear();
  }

  function fermer() {
    const processus = child;
    if (!processus) return;
    arret(processus, "Grok a été fermé.");
    processus.stdin?.end();
    processus.kill("SIGTERM");
  }

  function lire(ligne: string) {
    let msg: { id?: number | string; method?: string; params?: Json; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(ligne);
    } catch {
      return;
    }
    if (msg.method && msg.id !== undefined) return demande(msg.id, msg.method, msg.params ?? {});
    if (msg.method) return notification(msg.method, msg.params ?? {});
    if (typeof msg.id !== "number") return;
    const attente = attentes.get(msg.id);
    if (!attente) return;
    attentes.delete(msg.id);
    if (msg.error) attente.reject(new Error(msg.error.message || "Grok a refusé la demande."));
    else attente.resolve(msg.result);
  }

  function notification(method: string, params: Json) {
    if (method !== "session/update") return;
    const r = typeof params.sessionId === "string" ? enCours.get(params.sessionId) : undefined;
    const update = objet(params.update);
    if (update.sessionUpdate === "config_option_update" && typeof params.sessionId === "string") noterOptions(params.sessionId, update.configOptions);
    if (update.sessionUpdate === "current_mode_update" && typeof params.sessionId === "string") {
      const s = sessions.get(params.sessionId);
      if (s && typeof update.currentModeId === "string") s.mode = update.currentModeId;
    }
    if (r) r.derniere = Date.now();
    r?.tour.update(update);
  }

  /** Une demande de Grok : une autorisation (montrée, ou accordée d'office en accès complet) ; le reste est refusé. */
  function demande(rpcId: number | string, method: string, params: Json) {
    const r = typeof params.sessionId === "string" ? enCours.get(params.sessionId) : undefined;
    if (r) r.derniere = Date.now();
    if (method === "session/request_permission" && r) {
      if (r.acces === "tout") return ecrire({ id: rpcId, result: reponseAutorisationAcp(params, "oui") });
      const id = String(rpcId);
      r.demandes.set(id, { rpcId, params });
      r.emit({ type: "autorisation", id, ...autorisationAcp(params) });
      return;
    }
    if (method === "session/request_permission") return ecrire({ id: rpcId, result: { outcome: { outcome: "cancelled" } } });
    // L'app n'offre ni ses fichiers ni son terminal (capacités à false) : Grok utilise ses propres outils.
    ecrire({ id: rpcId, error: { code: -32601, message: `KLYRA ne gère pas « ${method} ».` } });
  }

  function demarrer(chemin: string): Promise<void> {
    if (demarrage && bin === chemin && child) return demarrage;
    fermer();
    bin = chemin;
    stderr = "";
    const processus = spawn(chemin, ["agent", "stdio"], { cwd: o.cwd(), env: { ...o.env(), ...ENV_GROK }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child = processus;
    let tampon = "";
    processus.stdout!.on("data", (d: Buffer) => {
      tampon += d.toString();
      let fin: number;
      while ((fin = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, fin).trim();
        tampon = tampon.slice(fin + 1);
        if (ligne) lire(ligne);
      }
    });
    processus.stderr!.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    processus.on("error", (error) => arret(processus, `Impossible de lancer Grok : ${error.message}`));
    processus.on("close", (code) => arret(processus, stderr.trim().split("\n").slice(-3).join(" ").slice(0, 600) || `Grok s’est arrêté (code ${code}).`));
    demarrage = requete<{ agentInfo?: { version?: unknown } }>("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: o.client,
    }).then((r) => {
      version = typeof r?.agentInfo?.version === "string" ? r.agentInfo.version : null;
    });
    demarrage.catch(() => fermer());
    return demarrage;
  }

  async function pret(): Promise<void> {
    const chemin = o.trouver();
    if (!chemin) throw new Error("Grok n’est pas installé : installe Grok Build dans Réglages du serveur › Fournisseurs.");
    await demarrer(chemin);
  }

  function noterOptions(sessionId: string, configOptions: unknown) {
    const lues = lireOptions(configOptions);
    if (lues.modeles.length) modelesConnus = lues.modeles;
    const s = sessions.get(sessionId);
    if (s) {
      s.modele = lues.modele ?? s.modele;
      s.effort = lues.effort ?? s.effort;
    }
  }

  /** Retient une session que Grok vient d'ouvrir ou de recharger (ses modes, ses options). */
  function retenir(sessionId: string, signature: string, r: { modes?: unknown; configOptions?: unknown } | null) {
    const modes = objet(r?.modes);
    const disponibles = Array.isArray(modes.availableModes) ? (modes.availableModes as { id?: unknown }[]).map((m) => m.id).filter((id): id is string => typeof id === "string") : [];
    sessions.set(sessionId, { signature, modes: disponibles, mode: typeof modes.currentModeId === "string" ? modes.currentModeId : null, modele: null, effort: null });
    noterOptions(sessionId, r?.configOptions);
  }

  /** Fait répondre Grok. Se termine toujours par un événement `fin`. */
  function lancer(requestId: string, d: TourDemande, emit: (event: AgentEvent) => void): void {
    const echec = (erreur: string) => emit({ type: "fin", ok: false, texte: "", erreur });
    if (d.sessionId !== null && !ID_SESSION.test(d.sessionId)) return echec("Session invalide.");
    if (d.modele && !/^[a-zA-Z0-9][a-zA-Z0-9.:\-_/]{0,95}$/.test(d.modele)) return echec("Modèle invalide.");
    if (d.effort && !/^[a-z]{1,16}$/.test(d.effort)) return echec("Effort invalide.");
    demarrerTour(requestId, d, emit).catch((error: unknown) => echec(error instanceof Error ? error.message : String(error)));
  }

  async function demarrerTour(requestId: string, d: TourDemande, emit: (event: AgentEvent) => void) {
    await pret();
    const nouvelle = async () => {
      const r = await requete<{ sessionId: string; modes?: unknown; configOptions?: unknown }>("session/new", {
        cwd: d.cwd,
        mcpServers: d.mcp,
        _meta: { rules: d.regles, ...(d.acces === "tout" ? { yoloMode: true } : {}) },
      });
      retenir(r.sessionId, d.signature, r);
      emit({ type: "session", sessionId: r.sessionId });
      return r.sessionId;
    };

    let sessionId = d.sessionId;
    if (!sessionId) sessionId = await nouvelle();
    else if (sessions.get(sessionId)?.signature !== d.signature) {
      try {
        // Les consignes restent celles du début de la session ; les serveurs MCP sont à jour.
        const r = await requete<{ modes?: unknown; configOptions?: unknown } | null>("session/load", { sessionId, cwd: d.cwd, mcpServers: d.mcp });
        retenir(sessionId, d.signature, r);
      } catch {
        /* Une session d'un autre moteur, ou effacée : la conversation repart sur une nouvelle. */
        sessionId = await nouvelle();
      }
    }
    if (enCours.has(sessionId)) throw new Error("Une réponse est déjà en cours dans cette conversation.");

    const session = sessions.get(sessionId)!;
    const mode = modePour(d.acces, session.modes, session.mode);
    if (mode) {
      await requete("session/set_mode", { sessionId, modeId: mode }).catch(() => undefined);
      session.mode = mode;
    }
    if (d.modele && d.modele !== session.modele) {
      noterOptions(sessionId, (await requete<{ configOptions?: unknown } | null>("session/set_config_option", { sessionId, configId: "model", value: { value: d.modele } }))?.configOptions);
      session.modele = d.modele;
    }
    if (d.effort && d.effort !== session.effort) {
      const r = await requete<{ configOptions?: unknown } | null>("session/set_config_option", { sessionId, configId: "reasoning_effort", value: { value: d.effort } }).catch(() => null);
      noterOptions(sessionId, r?.configOptions);
      session.effort = d.effort;
    }

    const reponse: Reponse = { requestId, tour: new TourAcp(sessionId, emit), acces: d.acces, emit, demandes: new Map(), derniere: Date.now() };
    enCours.set(sessionId, reponse);
    parRequete.set(requestId, sessionId);
    const id = sessionId;
    reponse.veille = setInterval(() => {
      // Attendre ton accord n'est pas un silence de Grok.
      if (reponse.demandes.size > 0) reponse.derniere = Date.now();
      if (Date.now() - reponse.derniere < INACTIVITE_MAX_MS) return;
      ecrire({ method: "session/cancel", params: { sessionId: id } });
      terminer(id, reponse, null, `Grok ne répond plus depuis ${Math.round(INACTIVITE_MAX_MS / 60_000)} min : la réponse est arrêtée. Relance ton message.`);
    }, VEILLE_PAS_MS);
    reponse.veille.unref?.();
    // Un tour peut durer longtemps : pas de délai sur le prompt, la veille ci-dessus s'en charge.
    requete<{ stopReason?: unknown }>("session/prompt", { sessionId, prompt: [{ type: "text", text: d.prompt }] }, 0)
      .then((r) => terminer(id, reponse, r))
      .catch((error: unknown) => terminer(id, reponse, null, error instanceof Error ? error.message : String(error)));
  }

  function terminer(sessionId: string, r: Reponse, resultat: { stopReason?: unknown } | null, erreur?: string) {
    if (enCours.get(sessionId) === r) enCours.delete(sessionId);
    parRequete.delete(r.requestId);
    clearInterval(r.veille);
    for (const [id, attente] of r.demandes) {
      ecrire({ id: attente.rpcId, result: { outcome: { outcome: "cancelled" } } });
      r.emit({ type: "autorisation-fin", id, accepte: false });
    }
    r.demandes.clear();
    r.tour.finir(resultat, erreur);
  }

  const reponseDe = (requestId: string) => {
    const sessionId = parRequete.get(requestId);
    return sessionId ? enCours.get(sessionId) : undefined;
  };

  /** Arrête une réponse ; false si elle n'est pas à Grok. */
  function arreter(requestId: string): boolean {
    const r = reponseDe(requestId);
    if (!r) return false;
    r.tour.arrete = true;
    ecrire({ method: "session/cancel", params: { sessionId: r.tour.sessionId } });
    // Sans réponse de Grok, la réponse se termine quand même.
    setTimeout(() => {
      if (enCours.get(r.tour.sessionId) === r) terminer(r.tour.sessionId, r, { stopReason: "cancelled" });
    }, ARRET_MAX_MS);
    return true;
  }

  /** Transmet ta réponse à une demande d'autorisation ; false si elle n'est pas à Grok. */
  function autoriser(requestId: string, demandeId: string, decision: Decision): boolean {
    const r = reponseDe(requestId);
    const attente = r?.demandes.get(demandeId);
    if (!r || !attente) return false;
    ecrire({ id: attente.rpcId, result: reponseAutorisationAcp(attente.params, decision) });
    r.demandes.delete(demandeId);
    r.emit({ type: "autorisation-fin", id: demandeId, accepte: decision !== "non" });
    return true;
  }

  /**
   * Les modèles que Grok annonce : ceux de la dernière session ouverte ; sans session encore, une
   * session ouverte pour les lire dans `dossier` (vide), sans serveur MCP.
   */
  async function modeles(dossier: string): Promise<ModeleMoteur[]> {
    if (modelesConnus) return modelesConnus;
    await pret();
    const r = await requete<{ sessionId: string; configOptions?: unknown }>("session/new", { cwd: dossier, mcpServers: [] });
    noterOptions(r.sessionId, r.configOptions);
    return modelesConnus ?? [];
  }

  /**
   * La facturation de l'abonnement : `_x.ai/billing`, l'extension de Grok Build qui donne à son interface
   * les crédits restants (`BillingConfigResponse`, lue par `lireUtilisationGrok`). Le `_` est obligatoire :
   * c'est le préfixe des extensions d'ACP, sans lui Grok répond « Method not found ». Une lecture du compte,
   * sans modèle. Sans paramètre d'abord ; si Grok la refuse, avec la dernière session ouverte.
   */
  async function facturation(): Promise<unknown> {
    await pret();
    try {
      return await requeteBornee("_x.ai/billing", {}, FACTURATION_MAX_MS);
    } catch (erreur) {
      const sessionId = [...sessions.keys()].at(-1);
      if (!sessionId) throw erreur;
      return requeteBornee("_x.ai/billing", { sessionId }, FACTURATION_MAX_MS);
    }
  }

  return {
    lancer,
    arreter,
    autoriser,
    modeles,
    facturation,
    fermer,
    demarrer: pret,
    get version() {
      return version;
    },
  };
}

export type ClientAcp = ReturnType<typeof creerClientAcp>;

/* ─── Le compte ────────────────────────────────────────────────── */

/**
 * Une adresse e-mail lue dans `auth.json` de Grok, sans jamais rendre un jeton : seulement une chaîne
 * qui a la forme d'une adresse, sous une clé qui parle d'e-mail. null si rien de tel.
 */
export function emailDeAuth(contenu: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(contenu);
  } catch {
    return null;
  }
  const chercher = (v: unknown, profondeur: number): string | null => {
    if (profondeur > 4 || !v || typeof v !== "object") return null;
    for (const [cle, valeur] of Object.entries(v as Json)) {
      if (/e-?mail/i.test(cle) && typeof valeur === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i.test(valeur)) return valeur;
      const sous = chercher(valeur, profondeur + 1);
      if (sous) return sous;
    }
    return null;
  };
  return chercher(json, 0);
}

/** Le lien et le code d'une connexion par code d'appareil, lus dans ce qu'écrit `grok login --device-auth`. */
export function lireCodeAppareil(sortie: string): { url: string; code: string } | null {
  const propre = sortie.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const url = /https:\/\/[^\s"'<>)]+/.exec(propre)?.[0];
  const code = /\bcode\b[^A-Za-z0-9]{0,12}([A-Z0-9]{3,6}(?:-[A-Z0-9]{3,6})+|[A-Z0-9]{6,10})\b/i.exec(propre)?.[1] ?? /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(propre)?.[1];
  return url && code ? { url: url.replace(/[.,;]+$/, ""), code } : null;
}
