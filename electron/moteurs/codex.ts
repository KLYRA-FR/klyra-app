import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, shell } from "electron";
import { consignesApp, dossierDeTravail, environnementAgent, pasDansMesAgents } from "../claude";
import { signatureOrdinateur } from "../ordinateur/pilote";
import { signatureNavigateur } from "../navigateur/outils";
import { espaceComposio } from "../composio";
import { consigneSkillsCodex, promptAvecSkillCodex } from "../connaissances-agent";
import { configMcp } from "../ia";
import { dossierAgents, estActif, generation } from "../mes-agents";
import { accesCodex, autorisationDe, corpsDeFiche, mcpPourCodex, reponseAutorisation, reponseDOffice, TourCodex } from "./codex-protocole";
import { binaireGere, commande, derniereVersionNpm, estGere, installerDepuisNpm } from "./installation";
import type { AgentEvent, CompteMoteur, Decision, ModeleMoteur, Moteur, Progression, StreamOptions } from "./types";

/**
 * ChatGPT, par Codex : un `codex app-server` pour tout le poste, gardé ouvert, et un fil de Codex
 * par conversation. Ses messages sont traduits en `AgentEvent` (codex-protocole.ts), comme ceux
 * de Claude Code : l'interface ne voit pas la différence.
 */

const HOME = os.homedir();
const EXE = process.platform === "win32" ? "codex.exe" : "codex";
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const CONNEXION_MAX_MS = 5 * 60 * 1000;
const ARRET_MAX_MS = 5000;

/** Sous Windows, npm ne met qu'un codex.cmd dans le PATH : le binaire natif est dans le paquet. */
function depuisNpmWindows(): string[] {
  if (!process.env.APPDATA) return [];
  const paquet = path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex");
  const vendors = [path.join(paquet, "vendor"), ...["codex-win32-x64", "codex-win32-arm64"].map((p) => path.join(paquet, "node_modules", "@openai", p, "vendor"))];
  return vendors.filter((v) => existsSync(v)).flatMap((v) => readdirSync(v).map((cible) => path.join(v, cible, "bin", EXE)));
}

/** Celui du poste d'abord (comme `findClaude`), puis celui que l'app a installé. */
export function trouverCodex(): string | null {
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, EXE));
  const candidats = [
    process.env.KLYRA_CODEX_PATH,
    ...fromPath,
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(HOME, ".local", "bin", EXE),
    ...depuisNpmWindows(),
    binaireGere("codex", EXE),
  ];
  return candidats.find((c): c is string => !!c && existsSync(c)) ?? null;
}

/** La fiche de l'agent (`~/.claude/agents/<nom>.md`, sous-dossiers compris), sans son en-tête. */
function ficheDe(agent: string): string | null {
  const brute = ficheBrute(agent);
  return brute ? corpsDeFiche(brute) : null;
}

/** La fiche entière, en-tête compris (ses `skills`). */
function ficheBrute(agent: string): string | null {
  const chercher = (dossier: string, profondeur: number): string | null => {
    const direct = path.join(dossier, `${agent}.md`);
    if (existsSync(direct)) return direct;
    if (profondeur === 0 || !existsSync(dossier)) return null;
    for (const nom of readdirSync(dossier)) {
      const sous = path.join(dossier, nom);
      if (!nom.startsWith(".") && statSync(sous).isDirectory()) {
        const trouve = chercher(sous, profondeur - 1);
        if (trouve) return trouve;
      }
    }
    return null;
  };
  const fichier = chercher(dossierAgents(), 3);
  return fichier ? readFileSync(fichier, "utf8") : null;
}

const CONFIG_CLAUDE = () => process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");

/** Ce qui change avec Codex : il n'appelle pas un collègue directement, il passe par les fils. */
const CONSIGNE_CODEX = "Dans cette session, tu travailles avec ChatGPT (Codex) : tu ne peux pas appeler un agent directement. Pour confier un travail, ouvre un fil avec ouvrir_fil.";
const CONSIGNE_CODEX_SEUL = "Dans cette session, tu travailles avec ChatGPT (Codex) et tu ne peux confier aucun travail : fais ta part seul et dis ce qui reste.";

function consigne(options: StreamOptions, mcp: string | null, skills: string | null): string {
  const fiche = options.agent ? ficheDe(options.agent) : null;
  return [fiche, ...consignesApp(options, mcp), skills, mcp ? CONSIGNE_CODEX : CONSIGNE_CODEX_SEUL].filter(Boolean).join("\n\n");
}

/* ─── Le serveur de Codex ──────────────────────────────────────── */

type Params = Record<string, unknown>;

/** Une réponse en cours, sur un fil de Codex. */
interface Reponse {
  requestId: string;
  threadId: string;
  tour: TourCodex;
  emit: (event: AgentEvent) => void;
  /** Les demandes d'autorisation en attente de ta réponse, par identifiant montré à l'interface. */
  demandes: Map<string, { rpcId: number | string; method: string; params: Params }>;
}

class ServeurCodex {
  private child: ChildProcess | null = null;
  private bin: string | null = null;
  private demarrage: Promise<void> | null = null;
  private suivant = 0;
  private attentes = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ecouteurs = new Set<(method: string, params: Params) => void>();
  private stderr = "";
  version: string | null = null;
  /** Les fils chargés dans ce serveur, avec ce qui les a configurés (agent, Mes agents, Composio). */
  readonly fils = new Map<string, string>();
  /** Les jetons déjà écrits dans chaque fil, pour compter ceux d'une réponse. */
  readonly jetons = new Map<string, number>();
  readonly enCours = new Map<string, Reponse>();
  readonly parRequete = new Map<string, string>();

  demarrer(bin: string): Promise<void> {
    if (this.demarrage && this.bin === bin && this.child) return this.demarrage;
    this.fermer();
    this.bin = bin;
    const child = spawn(bin, ["app-server"], { cwd: HOME, env: environnementAgent(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    let tampon = "";
    child.stdout!.on("data", (d: Buffer) => {
      tampon += d.toString();
      let fin: number;
      while ((fin = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, fin).trim();
        tampon = tampon.slice(fin + 1);
        if (ligne) this.lire(ligne);
      }
    });
    child.stderr!.on("data", (d: Buffer) => (this.stderr = (this.stderr + d.toString()).slice(-2000)));
    child.on("error", (error) => this.arret(child, `Impossible de lancer Codex : ${error.message}`));
    child.on("close", (code) => this.arret(child, this.stderr.trim().split("\n").filter((l) => !/^WARNING/.test(l)).slice(-3).join(" ").slice(0, 600) || `Codex s’est arrêté (code ${code}).`));
    this.demarrage = this.requete<{ userAgent?: string }>("initialize", {
      clientInfo: { name: "klyra", title: "KLYRA", version: app.getVersion() },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }).then((r) => {
      this.version = /\/(\d+\.\d+\.\d+)/.exec(r.userAgent ?? "")?.[1] ?? null;
      this.ecrire({ method: "initialized" });
    });
    this.demarrage.catch(() => this.fermer());
    return this.demarrage;
  }

  /** Le serveur s'est arrêté : les réponses en cours finissent sur l'erreur, les fils sont à recharger. */
  private arret(child: ChildProcess, erreur: string) {
    if (this.child !== child) return;
    this.child = null;
    this.demarrage = null;
    this.fils.clear();
    for (const attente of this.attentes.values()) attente.reject(new Error(erreur));
    this.attentes.clear();
    for (const r of this.enCours.values()) r.emit({ type: "fin", ok: false, texte: "", erreur: r.tour.arrete ? "Arrêté par toi." : erreur });
    this.enCours.clear();
    this.parRequete.clear();
  }

  fermer() {
    const child = this.child;
    if (!child) return;
    this.arret(child, "Codex a été fermé.");
    child.stdin?.end();
    child.kill("SIGTERM");
  }

  ecrire(message: Params) {
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  requete<T>(method: string, params: Params): Promise<T> {
    if (!this.child) return Promise.reject(new Error("Codex n’est pas lancé."));
    const id = ++this.suivant;
    return new Promise<T>((resolve, reject) => {
      this.attentes.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ecrire({ id, method, params });
    });
  }

  /** Écoute les notifications (connexion au compte) ; rend de quoi arrêter d'écouter. */
  ecouter(ecouteur: (method: string, params: Params) => void): () => void {
    this.ecouteurs.add(ecouteur);
    return () => this.ecouteurs.delete(ecouteur);
  }

  /** Une réponse de Codex est finie : on oublie sa réponse en cours. */
  finir(r: Reponse) {
    if (this.enCours.get(r.threadId) !== r) return;
    this.enCours.delete(r.threadId);
    this.parRequete.delete(r.requestId);
    this.jetons.set(r.threadId, r.tour.jetonsDuFil);
  }

  private lire(ligne: string) {
    let msg: { id?: number | string; method?: string; params?: Params; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(ligne);
    } catch {
      return;
    }
    if (msg.method && msg.id !== undefined) return this.demande(msg.id, msg.method, msg.params ?? {});
    if (msg.method) return this.notification(msg.method, msg.params ?? {});
    if (typeof msg.id !== "number") return;
    const attente = this.attentes.get(msg.id);
    if (!attente) return;
    this.attentes.delete(msg.id);
    if (msg.error) attente.reject(new Error(msg.error.message || "Codex a refusé la demande."));
    else attente.resolve(msg.result);
  }

  private notification(method: string, params: Params) {
    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    const r = threadId ? this.enCours.get(threadId) : undefined;
    if (r && !(typeof params.turnId === "string" && r.tour.turnId && params.turnId !== r.tour.turnId)) {
      if (method === "serverRequest/resolved") {
        // Codex a tranché lui-même (tour arrêté) : la carte d'autorisation se ferme.
        const id = String(params.requestId);
        if (r.demandes.delete(id)) r.emit({ type: "autorisation-fin", id, accepte: false });
      } else if (r.tour.notification(method, params)) {
        this.finir(r);
      }
    }
    for (const ecouteur of this.ecouteurs) ecouteur(method, params);
  }

  private demande(rpcId: number | string, method: string, params: Params) {
    const r = typeof params.threadId === "string" ? this.enCours.get(params.threadId) : undefined;
    const carte = autorisationDe(method, params);
    if (carte && r) {
      const id = String(rpcId);
      r.demandes.set(id, { rpcId, method, params });
      r.emit({ type: "autorisation", id, ...carte });
      return;
    }
    this.ecrire({ id: rpcId, ...(carte ? { result: reponseAutorisation(method, params, "non") } : reponseDOffice(method)) });
  }
}

const serveur = new ServeurCodex();

/* ─── Une réponse ──────────────────────────────────────────────── */

function lancer(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void): void {
  const echec = (erreur: string) => emit({ type: "fin", ok: false, texte: "", erreur });
  const bin = trouverCodex();
  if (!bin) return echec("ChatGPT n’est pas installé sur ce poste : installe Codex dans Réglages du serveur › Fournisseurs.");
  if (options.agent !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.agent)) return echec("Nom d’agent invalide.");
  if (options.sessionId !== null && !/^[0-9a-f-]{36}$/.test(options.sessionId)) return echec("Session invalide.");
  if (options.modele && !/^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,63}$/.test(options.modele)) return echec("Modèle invalide.");
  if (options.effort && !EFFORTS.includes(options.effort)) return echec("Effort invalide.");
  if (options.agent !== null && !estActif(options.agent)) return echec(pasDansMesAgents(options.agent));
  const cwd = dossierDeTravail(options.dossier);
  if (!cwd) return echec(`Le dossier du projet est introuvable : ${options.dossier}`);
  demarrerTour(requestId, options, emit, bin, cwd).catch((error: unknown) => echec(error instanceof Error ? error.message : String(error)));
}

async function demarrerTour(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void, bin: string, cwd: string) {
  await serveur.demarrer(bin);
  const acces = accesCodex(options.acces ?? "projet");
  /* Les skills de Claude, que Codex ne lit pas de lui-même (cf. connaissances-agent.ts) : présentées par leur
     fichier, celles que la fiche précharge avec leur texte, et `/<skill>` demandé en tête du message. */
  const skills = consigneSkillsCodex(options.agent ? ficheBrute(options.agent) : null, CONFIG_CLAUDE(), cwd);
  // Mes agents, Composio, les skills ou le navigateur ont changé : le fil est rechargé avec les consignes et les outils à jour.
  const signature = JSON.stringify([options.agent, generation(), espaceComposio.signature(), options.routineRun ?? null, signatureOrdinateur(), skills.noms, signatureNavigateur()]);
  const reglages = () => {
    const mcp = configMcp({ chatId: options.chatId ?? "", roleId: options.agent ?? "principal", routineRun: options.routineRun }, espaceComposio.creerCapacite());
    return {
      cwd,
      approvalPolicy: acces.approvalPolicy,
      sandbox: acces.sandbox,
      developerInstructions: consigne(options, mcp, skills.texte),
      config: { mcp_servers: mcpPourCodex(mcp) },
      ...(options.modele ? { model: options.modele } : {}),
    };
  };

  let threadId = options.sessionId;
  if (!threadId) {
    const r = await serveur.requete<{ thread: { id: string } }>("thread/start", { ...reglages(), serviceName: "KLYRA" });
    threadId = r.thread.id;
    serveur.fils.set(threadId, signature);
    emit({ type: "session", sessionId: threadId });
  } else if (serveur.fils.get(threadId) !== signature) {
    if (serveur.fils.has(threadId)) await serveur.requete("thread/unsubscribe", { threadId }).catch(() => undefined);
    await serveur.requete("thread/resume", { threadId, ...reglages(), excludeTurns: true });
    serveur.fils.set(threadId, signature);
  }
  if (serveur.enCours.has(threadId)) throw new Error("Une réponse est déjà en cours dans cette conversation.");

  const reponse: Reponse = { requestId, threadId, tour: new TourCodex(threadId, emit, serveur.jetons.get(threadId) ?? 0), emit, demandes: new Map() };
  serveur.enCours.set(threadId, reponse);
  serveur.parRequete.set(requestId, threadId);
  try {
    const r = await serveur.requete<{ turn: { id: string } }>("turn/start", {
      threadId,
      input: [{ type: "text", text: promptAvecSkillCodex(options.prompt, options.skill, CONFIG_CLAUDE(), cwd), text_elements: [] }],
      cwd,
      approvalPolicy: acces.approvalPolicy,
      sandboxPolicy: acces.sandboxPolicy,
      ...(options.modele ? { model: options.modele } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
    });
    reponse.tour.turnId ??= r.turn.id;
    // Arrêtée avant que Codex ait donné le numéro de son tour.
    if (reponse.tour.arrete) arreter(requestId);
  } catch (error) {
    serveur.finir(reponse);
    throw error;
  }
}

function arreter(requestId: string): void {
  const threadId = serveur.parRequete.get(requestId);
  const r = threadId ? serveur.enCours.get(threadId) : undefined;
  if (!r) return;
  r.tour.arrete = true;
  if (!r.tour.turnId) return;
  void serveur.requete("turn/interrupt", { threadId: r.threadId, turnId: r.tour.turnId }).catch(() => undefined);
  // Sans réponse de Codex, la réponse se termine quand même.
  setTimeout(() => {
    if (serveur.enCours.get(r.threadId) !== r) return;
    serveur.finir(r);
    r.emit({ type: "fin", ok: false, texte: "", erreur: "Arrêté par toi.", sessionId: r.threadId });
  }, ARRET_MAX_MS);
}

function autoriser(requestId: string, demandeId: string, decision: Decision): boolean {
  const threadId = serveur.parRequete.get(requestId);
  const r = threadId ? serveur.enCours.get(threadId) : undefined;
  const demande = r?.demandes.get(demandeId);
  if (!r || !demande) return false;
  serveur.ecrire({ id: demande.rpcId, result: reponseAutorisation(demande.method, demande.params, decision) });
  r.demandes.delete(demandeId);
  r.emit({ type: "autorisation-fin", id: demandeId, accepte: decision !== "non" });
  return true;
}

/* ─── Compte et modèles ────────────────────────────────────────── */

type Compte = { type: string; email?: string | null; planType?: string | null } | null;

async function compte(): Promise<CompteMoteur> {
  const bin = trouverCodex();
  const vide: CompteMoteur = { installe: !!bin, chemin: bin, version: null, connecte: false, methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now() };
  if (!bin) return vide;
  await serveur.demarrer(bin);
  const { account, requiresOpenaiAuth } = await serveur.requete<{ account: Compte; requiresOpenaiAuth: boolean }>("account/read", { refreshToken: false });
  return {
    ...vide,
    version: serveur.version,
    // Un fournisseur réglé dans la config de Codex (clé, serveur compatible) répond sans compte OpenAI.
    connecte: !!account || !requiresOpenaiAuth,
    methode: account?.type === "chatgpt" ? "chatgpt" : account?.type === "apiKey" ? "cle-api" : account ? account.type : requiresOpenaiAuth ? null : "config",
    email: account?.email ?? null,
    abonnement: account?.planType ?? null,
  };
}

/** Connexion avec le compte ChatGPT : la page d'OpenAI s'ouvre dans le navigateur, Codex attend qu'elle soit validée. */
async function connecter(): Promise<CompteMoteur> {
  const bin = trouverCodex();
  if (!bin) return compte();
  await serveur.demarrer(bin);
  const { loginId, authUrl } = await serveur.requete<{ loginId: string; authUrl: string }>("account/login/start", { type: "chatgpt" });
  const fini = new Promise<void>((resolve) => {
    const delai = setTimeout(() => {
      arreterDEcouter();
      void serveur.requete("account/login/cancel", { loginId }).catch(() => undefined);
      resolve();
    }, CONNEXION_MAX_MS);
    const arreterDEcouter = serveur.ecouter((method, params) => {
      if (method !== "account/login/completed" || (params.loginId && params.loginId !== loginId)) return;
      clearTimeout(delai);
      arreterDEcouter();
      resolve();
    });
  });
  await shell.openExternal(authUrl);
  await fini;
  return compte();
}

async function connecterAvecCle(cle: string): Promise<CompteMoteur> {
  const bin = trouverCodex();
  if (!bin) return compte();
  if (!/^\S{10,400}$/.test(cle)) throw new Error("Cette clé ne ressemble pas à une clé API.");
  await serveur.demarrer(bin);
  await serveur.requete("account/login/start", { type: "apiKey", apiKey: cle });
  return compte();
}

async function deconnecter(): Promise<CompteMoteur> {
  const bin = trouverCodex();
  if (!bin) return compte();
  await serveur.demarrer(bin);
  await serveur.requete("account/logout", {});
  return compte();
}

type ModeleCodex = { id: string; displayName: string; hidden: boolean; isDefault: boolean; defaultReasoningEffort: string | null; supportedReasoningEfforts: { reasoningEffort: string }[] };

async function modeles(): Promise<ModeleMoteur[]> {
  const bin = trouverCodex();
  if (!bin) return [];
  await serveur.demarrer(bin);
  const liste: ModeleMoteur[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: ModeleCodex[]; nextCursor: string | null } = await serveur.requete("model/list", cursor ? { cursor } : {});
    for (const m of page.data) {
      if (m.hidden) continue;
      liste.push({ id: m.id, nom: m.displayName, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort), effortParDefaut: m.defaultReasoningEffort, parDefaut: m.isDefault });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return liste;
}

/** Installe le Codex d'OpenAI publié sur npm, pour ce système, dans ~/.klyra/moteurs/codex. */
async function installer(progression: (p: Progression) => void): Promise<CompteMoteur> {
  await installerDepuisNpm({ moteur: "codex", paquet: "@openai/codex", executable: EXE, progression });
  // Le serveur ouvert garde l'ancien programme : le prochain appel lance le nouveau.
  if (estGere(trouverCodex())) serveur.fermer();
  return compte();
}

async function mettreAJour(progression: (p: Progression) => void): Promise<CompteMoteur> {
  const bin = trouverCodex();
  if (!bin || estGere(bin)) return installer(progression);
  progression({ etape: "mise-a-jour", recu: 0, total: null });
  serveur.fermer();
  const r = await commande(bin, ["update"], 10 * 60_000);
  if (r.code !== 0) throw new Error(r.sortie.trim().split("\n").filter((l) => !/^WARNING/.test(l)).slice(-3).join(" ").slice(0, 400) || "La mise à jour de Codex a échoué.");
  return compte();
}

export const codex: Moteur = {
  id: "codex",
  nom: "Codex",
  fournisseur: "ChatGPT",
  trouver: trouverCodex,
  compte,
  connecter,
  connecterAvecCle,
  deconnecter,
  modeles,
  versionDisponible: () => derniereVersionNpm("@openai/codex"),
  installer,
  mettreAJour,
  lancer,
  arreter,
  autoriser,
  fermer: () => serveur.fermer(),
};
