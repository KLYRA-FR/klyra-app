import { app, nativeImage, type NativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { argumentsChrome, CHROME_A_LA_PERSONNE, CHROME_ABSENT, lirePortActif, trouverChrome, type ModeChrome } from "./chrome-regles";
import type { CadrePage, GestePage, Page } from "./page";

/**
 * Le Chrome de ce poste, piloté pour les agents (Réglages › Navigateur › « Chrome de ce poste »).
 *
 * Un seul profil, celui de KLYRA (`userData/navigateur-chrome`), jamais celui de la personne.
 * Deux façons de l'ouvrir, jamais en même temps (cf. `chrome-regles.ts`) :
 * - pour la personne, sans pilotage : elle s'y connecte elle-même (Google refuse un navigateur piloté) ;
 * - pour les agents, par le protocole de débogage sur un port local : la session ouverte y est déjà.
 * Chaque onglet de KLYRA est un onglet de ce Chrome (`PageChrome`). Une fenêtre ouverte par une page
 * garde son lien avec elle (connexions « Se connecter avec… ») et devient un onglet de la même conversation.
 */

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string }; sessionId?: string };

const DELAI_DEMARRAGE_MS = 20_000;
const DELAI_FERMETURE_MS = 15_000;
const MONDE = "klyra";

class ClientCdp {
  private suivant = 0;
  private attente = new Map<number, { ok: (r: unknown) => void; ko: (e: Error) => void }>();
  private ecoutes = new Set<(m: Message) => void>();
  ferme = false;

  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      let m: Message;
      try {
        m = JSON.parse(String(e.data)) as Message;
      } catch {
        return;
      }
      if (typeof m.id === "number" && this.attente.has(m.id)) {
        const a = this.attente.get(m.id)!;
        this.attente.delete(m.id);
        if (m.error) a.ko(new Error(m.error.message || "Erreur du protocole de Chrome."));
        else a.ok(m.result);
      } else if (m.method) for (const f of this.ecoutes) f(m);
    });
    ws.addEventListener("close", () => {
      this.ferme = true;
      for (const a of this.attente.values()) a.ko(new Error("Chrome s’est fermé."));
      this.attente.clear();
    });
  }

  static ouvrir(url: string): Promise<ClientCdp> {
    return new Promise((resoudre, rejeter) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resoudre(new ClientCdp(ws)), { once: true });
      ws.addEventListener("error", () => rejeter(new Error("Impossible de joindre Chrome.")), { once: true });
    });
  }

  envoyer<T = Record<string, unknown>>(methode: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.ferme) return Promise.reject(new Error("Chrome s’est fermé."));
    const id = ++this.suivant;
    return new Promise<T>((ok, ko) => {
      this.attente.set(id, { ok: ok as (r: unknown) => void, ko });
      this.ws.send(JSON.stringify(sessionId ? { id, method: methode, params, sessionId } : { id, method: methode, params }));
    });
  }

  ecouter(f: (m: Message) => void): () => void {
    this.ecoutes.add(f);
    return () => this.ecoutes.delete(f);
  }

  fermer(): void {
    try {
      this.ws.close();
    } catch {
      /* déjà fermé */
    }
  }
}

/* ─── Une page : un onglet du Chrome de ce poste ──────────────── */

export class PageChrome implements Page {
  readonly moteur = "chrome" as const;
  fermee = false;
  titre = "";
  peutReculer = false;
  peutAvancer = false;
  private adresse: string;
  private charge = false;
  private pilotee = false;
  private ecoutes = new Set<(methode: string, params: Record<string, unknown>) => void>();
  /** Les cadres d'un autre site (leur propre processus, absents de l'arbre de la page) : leur session et leur adresse. */
  private sessionsCadres = new Map<string, { session: string; url: string }>();
  private cadresLus = new Map<string, CadrePage>();

  constructor(
    private client: ClientCdp,
    readonly cible: string,
    readonly session: string,
    url: string,
  ) {
    this.adresse = url;
  }

  detruite(): boolean {
    return this.fermee || this.client.ferme;
  }

  url(): string {
    return this.adresse;
  }

  chargement(): boolean {
    return this.charge;
  }

  private envoyer<T = Record<string, unknown>>(methode: string, params: Record<string, unknown> = {}, session = this.session): Promise<T> {
    if (this.detruite()) return Promise.reject(new Error("Cet onglet de Chrome est fermé."));
    return this.client.envoyer<T>(methode, params, session);
  }

  /** Un script dans le monde isolé de KLYRA d'un cadre (le même monde d'un appel à l'autre, jusqu'à la navigation suivante). */
  private async evaluer<T>(session: string, cadre: string, code: string): Promise<T> {
    const { executionContextId } = await this.envoyer<{ executionContextId: number }>("Page.createIsolatedWorld", { frameId: cadre, worldName: MONDE }, session);
    const r = await this.envoyer<{ result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      "Runtime.evaluate",
      { expression: code, contextId: executionContextId, returnByValue: true, awaitPromise: true },
      session,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "Le script a échoué dans la page.");
    return r.result?.value as T;
  }

  script<T>(code: string): Promise<T> {
    return this.evaluer<T>(this.session, this.cible, code);
  }

  async cdp(methode: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.pilotee) {
      this.pilotee = true;
      // La page se croit au premier plan : la frappe arrive même dans un onglet qu'on ne regarde pas.
      await this.envoyer("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
    }
    return this.envoyer(methode, params);
  }

  ecouter(f: (methode: string, params: Record<string, unknown>) => void): () => void {
    this.ecoutes.add(f);
    return () => this.ecoutes.delete(f);
  }

  async image(): Promise<NativeImage> {
    const { data } = await this.envoyer<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 85 });
    return nativeImage.createFromBuffer(Buffer.from(data, "base64"));
  }

  async cadres(): Promise<CadrePage[]> {
    type Noeud = { frame: { id: string; name?: string; url?: string }; childFrames?: Noeud[] };
    const { frameTree } = await this.envoyer<{ frameTree: Noeud }>("Page.getFrameTree");
    this.cadresLus.clear();
    const directs = (frameTree.childFrames ?? []).map(({ frame }) => ({ id: frame.id, nom: frame.name ?? "", url: frame.url ?? "" }));
    const distants = [...this.sessionsCadres].filter(([id]) => !directs.some((d) => d.id === id)).map(([id, c]) => ({ id, nom: "", url: c.url }));
    return [...directs, ...distants].map((f) => {
      const c: CadrePage = {
        cle: f.id,
        nom: f.nom,
        url: f.url,
        script: <T,>(code: string) => this.evaluer<T>(this.sessionsCadres.get(f.id)?.session ?? this.session, f.id, code),
      };
      this.cadresLus.set(f.id, c);
      return c;
    });
  }

  cadre(cle: string): CadrePage | null {
    return this.cadresLus.get(cle) ?? null;
  }

  aller(url: string): void {
    this.adresse = url;
    void this.envoyer("Page.navigate", { url }).catch(() => undefined);
  }

  geste(g: GestePage): void {
    if (g === "recharger") void this.envoyer("Page.reload").catch(() => undefined);
    else if (g === "arreter") void this.envoyer("Page.stopLoading").catch(() => undefined);
    else
      void this.envoyer<{ currentIndex: number; entries: { id: number }[] }>("Page.getNavigationHistory")
        .then(({ currentIndex, entries }) => {
          const cible = entries[currentIndex + (g === "retour" ? -1 : 1)];
          if (cible) return this.envoyer("Page.navigateToHistoryEntry", { entryId: cible.id });
        })
        .catch(() => undefined);
  }

  /** Amène l'onglet devant, fenêtre comprise (la personne veut le voir dans Chrome). */
  async activer(): Promise<void> {
    await this.client.envoyer("Target.activateTarget", { targetId: this.cible });
    const { windowId } = await this.client.envoyer<{ windowId: number }>("Browser.getWindowForTarget", { targetId: this.cible });
    await this.client.envoyer("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }).catch(() => undefined);
  }

  fermer(): void {
    this.fermee = true;
    void this.client.envoyer("Target.closeTarget", { targetId: this.cible }).catch(() => undefined);
  }

  private async relireHistorique(): Promise<void> {
    const h = await this.envoyer<{ currentIndex: number; entries: unknown[] }>("Page.getNavigationHistory").catch(() => null);
    if (!h) return;
    this.peutReculer = h.currentIndex > 0;
    this.peutAvancer = h.currentIndex < h.entries.length - 1;
    rappels.changement(this);
  }

  /** Un événement de la session de cette page (ou d'un de ses cadres). */
  recevoir(m: Message): void {
    const p = (m.params ?? {}) as Record<string, unknown>;
    const principal = (p.frameId ?? (p.frame as { id?: string } | undefined)?.id) === this.cible;
    switch (m.method) {
      case "Page.frameStartedLoading":
        if (principal) {
          this.charge = true;
          rappels.changement(this);
        }
        break;
      case "Page.frameStoppedLoading":
        if (principal) {
          this.charge = false;
          void this.relireHistorique();
        }
        break;
      case "Page.frameNavigated": {
        const f = p.frame as { id?: string; parentId?: string; url?: string };
        if (!f.parentId && f.url) {
          this.adresse = f.url;
          void this.relireHistorique();
        }
        break;
      }
      case "Page.navigatedWithinDocument":
        if (principal && typeof p.url === "string") {
          this.adresse = p.url;
          void this.relireHistorique();
        }
        break;
      case "Target.attachedToTarget": {
        const info = p.targetInfo as { targetId?: string; type?: string; url?: string };
        if (info?.type === "iframe" && info.targetId && typeof p.sessionId === "string") this.sessionsCadres.set(info.targetId, { session: p.sessionId, url: info.url ?? "" });
        break;
      }
      case "Target.detachedFromTarget":
        for (const [cadre, c] of this.sessionsCadres) if (c.session === p.sessionId) this.sessionsCadres.delete(cadre);
        break;
    }
    if (m.sessionId === this.session && m.method) for (const f of this.ecoutes) f(m.method, p);
  }

  /** Pour Target.targetInfoChanged : l'adresse et le titre que Chrome montre. */
  infos(url: string, titre: string): void {
    if (url) this.adresse = url;
    this.titre = titre;
    rappels.changement(this);
  }

  /** Les sessions (page et cadres) dont cette page reçoit les événements. */
  possede(session: string): boolean {
    return session === this.session || [...this.sessionsCadres.values()].some((c) => c.session === session);
  }

  /** L'adresse d'un cadre d'un autre site, quand Chrome la donne (Target.targetInfoChanged). */
  majCadre(cible: string, url: string): void {
    const c = this.sessionsCadres.get(cible);
    if (c && url) c.url = url;
  }

  /** L'onglet passe devant dans sa fenêtre (sans amener la fenêtre) : ses captures sont immédiates. */
  devant(): void {
    void this.envoyer("Page.bringToFront").catch(() => undefined);
  }
}

/* ─── Le processus Chrome ─────────────────────────────────────── */

export interface Telechargement {
  guid: string;
  page: PageChrome | null;
  nom: string;
  /** Où Chrome l'écrit (sous son nom provisoire), avant que KLYRA le range. */
  provisoire: string;
}

/** Ce que `navigateur.ts` veut savoir de Chrome. */
interface Rappels {
  changement: (page: PageChrome) => void;
  fermeture: (page: PageChrome) => void;
  popup: (ouvrante: PageChrome, nouvelle: PageChrome) => void;
  telechargement: (t: Telechargement, etat: "debut" | "progression" | "fini" | "annule", recus: number, total: number) => void;
  /** Chrome s'est fermé (par la personne, ou pour changer de mode). */
  fin: (mode: ModeChrome) => void;
}

const rien = () => undefined;
const rappels: Rappels = { changement: rien, fermeture: rien, popup: rien, telechargement: rien, fin: rien };

export function brancherChrome(r: Partial<Rappels>): void {
  Object.assign(rappels, r);
}

let processus: ChildProcess | null = null;
let mode: ModeChrome | null = null;
let client: ClientCdp | null = null;
let demarrage: Promise<ClientCdp> | null = null;
const pages = new Map<string, PageChrome>();
const telechargements = new Map<string, Telechargement>();
/** Les onglets que Chrome ouvre seul au démarrage, fermés dès que KLYRA a le sien. */
let initiaux: string[] = [];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dossierProfil = () => path.join(app.getPath("userData"), "navigateur-chrome");
const dossierProvisoire = () => path.join(app.getPath("userData"), "navigateur-chrome-telechargements");

/** Le chemin de Chrome sur ce poste, ou null. */
export function cheminChrome(): string | null {
  return trouverChrome(process.platform, process.env, existsSync);
}

/** Dans quel mode Chrome est ouvert en ce moment (null : fermé). */
export function modeChrome(): ModeChrome | null {
  return mode;
}

function lancer(m: ModeChrome, url?: string): ChildProcess {
  const chemin = cheminChrome();
  if (!chemin) throw new Error(CHROME_ABSENT);
  mkdirSync(dossierProfil(), { recursive: true });
  if (m === "agent") rmSync(path.join(dossierProfil(), "DevToolsActivePort"), { force: true });
  const p = spawn(chemin, argumentsChrome(dossierProfil(), m, url), { stdio: "ignore", windowsHide: false });
  processus = p;
  mode = m;
  p.once("exit", () => {
    if (processus !== p) return;
    processus = null;
    mode = null;
    demarrage = null;
    client?.fermer();
    client = null;
    for (const page of pages.values()) page.fermee = true;
    pages.clear();
    telechargements.clear();
    rappels.fin(m);
  });
  p.once("error", () => undefined);
  return p;
}

/** Ferme Chrome proprement (ses cookies sont écrits avant) et attend qu'il soit sorti. */
export async function fermerChrome(): Promise<boolean> {
  const p = processus;
  if (!p) return true;
  const sorti = new Promise<void>((r) => p.once("exit", () => r()));
  if (client && !client.ferme) await client.envoyer("Browser.close").catch(() => undefined);
  else if (process.platform === "win32" && p.pid) spawn("taskkill", ["/PID", String(p.pid), "/T"], { stdio: "ignore", windowsHide: true }).once("error", () => undefined);
  else p.kill("SIGTERM");
  const ok = await Promise.race([sorti.then(() => true), pause(DELAI_FERMETURE_MS).then(() => false)]);
  return ok || processus !== p;
}

/** La personne se connecte : Chrome ordinaire (sans pilotage), sur cette page. Les onglets des agents s'endorment le temps de la connexion. */
export async function ouvrirPourLaPersonne(url: string): Promise<void> {
  if (mode === "agent" && !(await fermerChrome())) throw new Error("Chrome ne s’est pas fermé : ferme-le, puis réessaie.");
  if (mode === "personne") return; // déjà ouvert pour elle : elle y est
  lancer("personne", url);
}

/**
 * La personne a fini. Chrome n'écrit ses cookies sur le disque que toutes les 30 s environ, et ne
 * les écrit tous qu'en fermant ses fenêtres : une fermeture par signal perd une connexion toute
 * fraîche (vérifié avec Chromium 153 sous Linux). Sous Windows, `taskkill` sans /F ferme ses
 * fenêtres comme un clic sur la croix ; ailleurs, c'est la personne qui ferme Chrome (sur Mac,
 * le quitter), et KLYRA voit sa fermeture. Les agents le rouvriront ensuite, pilotable.
 */
export async function terminerPourLaPersonne(): Promise<"ferme" | "a-fermer"> {
  const p = processus;
  if (mode !== "personne" || !p) return "ferme";
  if (process.platform !== "win32" || !p.pid) return "a-fermer";
  const sorti = new Promise<void>((r) => p.once("exit", () => r()));
  spawn("taskkill", ["/PID", String(p.pid), "/T"], { stdio: "ignore", windowsHide: true }).once("error", () => undefined);
  const ok = await Promise.race([sorti.then(() => true), pause(DELAI_FERMETURE_MS).then(() => false)]);
  return ok || processus !== p ? "ferme" : "a-fermer";
}

/** Chrome pilotable, lancé au besoin. Refusé tant que la personne s'y connecte. */
async function connexionAgent(): Promise<ClientCdp> {
  if (mode === "personne") throw new Error(CHROME_A_LA_PERSONNE);
  if (client && !client.ferme) return client;
  demarrage ??= (async () => {
    const p = lancer("agent");
    const fichier = path.join(dossierProfil(), "DevToolsActivePort");
    const limite = Date.now() + DELAI_DEMARRAGE_MS;
    let lu: { port: number; chemin: string } | null = null;
    while (!lu && Date.now() < limite && processus === p) {
      if (existsSync(fichier)) lu = lirePortActif(readFileSync(fichier, "utf8"));
      if (!lu) await pause(100);
    }
    if (!lu) {
      if (processus === p) p.kill();
      throw new Error("Chrome n’a pas démarré à temps. S’il est déjà ouvert avec le profil de KLYRA, ferme-le et réessaie.");
    }
    const c = await ClientCdp.ouvrir(`ws://127.0.0.1:${lu.port}${lu.chemin}`);
    c.ecouter(recevoir);
    await c.envoyer("Target.setDiscoverTargets", { discover: true });
    mkdirSync(dossierProvisoire(), { recursive: true });
    await c.envoyer("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dossierProvisoire(), eventsEnabled: true }).catch(() => undefined);
    const { targetInfos } = await c.envoyer<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets");
    initiaux = targetInfos.filter((t) => t.type === "page").map((t) => t.targetId);
    client = c;
    return c;
  })().catch((e) => {
    demarrage = null;
    throw e;
  });
  return demarrage;
}

async function rattacher(c: ClientCdp, cible: string, url: string): Promise<PageChrome> {
  const { sessionId } = await c.envoyer<{ sessionId: string }>("Target.attachToTarget", { targetId: cible, flatten: true });
  const page = new PageChrome(c, cible, sessionId, url);
  pages.set(cible, page);
  await c.envoyer("Page.enable", {}, sessionId).catch(() => undefined);
  await c.envoyer("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => undefined);
  return page;
}

/** Un nouvel onglet de Chrome sur cette adresse (en arrière-plan : la personne garde ce qu'elle regarde). */
export async function ouvrirPage(url: string): Promise<PageChrome> {
  const c = await connexionAgent();
  const { targetId } = await c.envoyer<{ targetId: string }>("Target.createTarget", { url: "about:blank", background: true });
  const page = await rattacher(c, targetId, url);
  if (url !== "about:blank") page.aller(url);
  for (const t of initiaux.splice(0)) if (t !== targetId) void c.envoyer("Target.closeTarget", { targetId: t }).catch(() => undefined);
  return page;
}

function recevoir(m: Message): void {
  const p = (m.params ?? {}) as Record<string, unknown>;
  if (m.sessionId) {
    for (const page of pages.values()) if (page.possede(m.sessionId)) page.recevoir(m);
    return;
  }
  switch (m.method) {
    case "Target.targetCreated": {
      const info = p.targetInfo as { targetId: string; type: string; openerId?: string; url?: string };
      const ouvrante = info.type === "page" && info.openerId ? pages.get(info.openerId) : undefined;
      if (ouvrante && client && !pages.has(info.targetId))
        void rattacher(client, info.targetId, info.url || "about:blank")
          .then((nouvelle) => rappels.popup(ouvrante, nouvelle))
          .catch(() => undefined);
      break;
    }
    case "Target.targetInfoChanged": {
      const info = p.targetInfo as { targetId: string; type?: string; url?: string; title?: string };
      if (info.type === "iframe") for (const page of pages.values()) page.majCadre(info.targetId, info.url ?? "");
      else pages.get(info.targetId)?.infos(info.url ?? "", info.title ?? "");
      break;
    }
    case "Target.targetDestroyed": {
      const page = pages.get(String(p.targetId));
      if (page) {
        page.fermee = true;
        pages.delete(page.cible);
        rappels.fermeture(page);
      }
      break;
    }
    case "Browser.downloadWillBegin": {
      const guid = String(p.guid);
      const t: Telechargement = { guid, page: pages.get(String(p.frameId)) ?? null, nom: String(p.suggestedFilename || "telechargement"), provisoire: path.join(dossierProvisoire(), guid) };
      telechargements.set(guid, t);
      rappels.telechargement(t, "debut", 0, 0);
      break;
    }
    case "Browser.downloadProgress": {
      const t = telechargements.get(String(p.guid));
      if (!t) break;
      const etat = p.state === "completed" ? "fini" : p.state === "canceled" ? "annule" : "progression";
      if (etat !== "progression") telechargements.delete(t.guid);
      rappels.telechargement(t, etat, Number(p.receivedBytes) || 0, Number(p.totalBytes) || 0);
      break;
    }
  }
}

/** Arrête un téléchargement (trop lourd). */
export function annulerTelechargement(guid: string): void {
  void client?.envoyer("Browser.cancelDownload", { guid }).catch(() => undefined);
}

/** Efface le profil de KLYRA (cookies, connexions, cache) : Chrome est fermé d'abord. */
export async function effacerProfilChrome(): Promise<void> {
  if (processus && !(await fermerChrome())) throw new Error("Chrome ne s’est pas fermé : ferme-le, puis réessaie.");
  rmSync(dossierProfil(), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** À la fermeture de l'app : Chrome pilotable se ferme avec elle (celui de la personne reste à elle). */
export function quitterChrome(): void {
  if (mode === "agent") void fermerChrome();
}
