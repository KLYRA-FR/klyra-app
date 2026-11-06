import { app, clipboard, shell, session as sessions, webFrameMain, WebContentsView, type BrowserWindow, type Session, type WebContents, type WebFrameMain } from "electron";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { lireReglages } from "../reglages";
import { annulerTelechargement, brancherChrome, cheminChrome, effacerProfilChrome, modeChrome, ouvrirPage, ouvrirPourLaPersonne, PageChrome, terminerPourLaPersonne } from "./chrome-poste";
import { CHROME_A_LA_PERSONNE, CHROME_ABSENT } from "./chrome-regles";
import { connexionsPour, secretPour, type ConnexionCoffre } from "./coffre";
import type { CadrePage, GestePage, MoteurNavigateur, Page } from "./page";
import { entetesAvecIndices, identiteChrome, indicesDemandes, type IdentiteNavigateur, type MetadonneesAgent } from "./identite";
import {
  adresseAutorisee,
  decouperRef,
  evenementsTouche,
  hoteDe,
  MONDE_ISOLE,
  normaliserAdresse,
  RECHERCHE,
  SCRIPT_INSTANTANE,
  scriptDemarquerFichier,
  scriptFichier,
  scriptInstantane,
  scriptPlaceCadre,
  scriptRemplirConnexion,
  SCRIPT_TEXTE,
  SCRIPT_VALEUR_FOCUS,
  scriptChoisir,
  scriptCible,
  scriptContient,
  scriptCurseur,
  scriptDefiler,
  scriptFocus,
  type CadreLu,
  type InstantanePage,
} from "./regles";

/**
 * Le navigateur de KLYRA : de vraies pages Chromium (WebContentsView) posées
 * dans la fenêtre de l'app. L'écran les montre dans le panneau de la conversation
 * (comme l’aperçu, la conversation reste à côté), sur le modèle d’OpenBot (`browser-host.ts`).
 *
 * - Chaque onglet appartient à une conversation : son agent ne voit et ne pilote
 *   que ceux-là, la personne les voit dans le panneau de cette conversation.
 * - Une seule session de navigation, privée à KLYRA et gardée sur le disque
 *   (`persist:klyra-navigateur`) : une connexion faite par la personne sert
 *   ensuite à l'agent. Rien de l'app n'y est exposé : ni preload, ni Node, bac
 *   à sable, seulement http(s), aucune autorisation sauf écrire dans le presse-papiers.
 * - L'agent agit par le protocole de débogage de Chromium (clics et frappes
 *   « de confiance », comme une vraie souris), lit la page dans un monde isolé
 *   (cf. `regles.ts`), et ne remplit jamais un mot de passe, un code ou une carte.
 * - La personne peut reprendre la main sur un onglet ; l'agent peut la lui
 *   passer (connexion, CAPTCHA, paiement). Tant qu'elle l'a, l'agent lit mais n'agit pas.
 */

export interface Telechargement {
  nom: string;
  chemin: string;
  etat: "en-cours" | "fini" | "annule" | "echec";
  recus: number;
  total: number;
}

export type MainOnglet = null | { type: "personne" } | { type: "demandee"; roleId: string; raison: string };

/** Ce que l'écran voit d'un onglet. */
export interface OngletPublic {
  id: string;
  chatId: string;
  url: string;
  titre: string;
  chargement: boolean;
  peutReculer: boolean;
  peutAvancer: boolean;
  erreur: string | null;
  vignette: string | null;
  /** Pas de page en mémoire : l'onglet se réveille quand on l'ouvre. */
  endormi: boolean;
  /** Sa page est à l’écran (dans le panneau de la conversation). */
  affiche: boolean;
  /** L'agent qui l'utilise en ce moment, et sa dernière action. */
  pilote: { roleId: string; action: string; at: number } | null;
  main: MainOnglet;
  telechargements: Telechargement[];
  creeLe: number;
  vuLe: number;
  /** Où vit sa page : la vue intégrée de KLYRA, ou un onglet du Chrome de ce poste. */
  moteur: MoteurNavigateur;
  /**
   * Chrome est ouvert, sans pilotage, pour que la personne s'y connecte depuis cet onglet ;
   * `a-fermer` : elle a fini, et c'est en fermant Chrome qu'elle enregistre sa connexion.
   */
  connexion: null | "ouverte" | "a-fermer";
}

interface Onglet extends Omit<OngletPublic, "endormi" | "affiche"> {
  vue: WebContentsView | null;
  /** Son onglet dans le Chrome de ce poste (moteur « chrome »), et son ouverture en cours. */
  chrome: PageChrome | null;
  preparation: Promise<Page> | null;
  /** La main a été prise pour se connecter dans Chrome : elle revient seule quand Chrome se ferme. */
  mainParConnexion: boolean;
  /** 1 px de la dernière capture = `echelle` px de la page. */
  echelle: number;
  /** Ce que la page a demandé (alert, confirm) pendant que l'agent pilotait, à lui dire. */
  notes: string[];
  minuteurPilote: NodeJS.Timeout | null;
  minuteurVignette: NodeJS.Timeout | null;
  derniereVignette: number;
  /** Les cadres de la dernière lecture (c1, c2…) : leur clé dans la page, et l'élément iframe qui les situe. */
  cadres: Map<string, { cle: string; refIframe: string }>;
  /** Le dernier menu du clic droit ouvert par la personne : ses actions ne lisent que lui. */
  menu: ParametresMenu | null;
}

/** Ce que l'écran reçoit d'un clic droit dans une page, pour dessiner le menu de l'app. */
export interface ParametresMenu {
  x: number;
  y: number;
  lien: string | null;
  texteLien: string;
  image: string | null;
  selection: string;
  editable: boolean;
  peut: { couper: boolean; copier: boolean; coller: boolean; toutSelectionner: boolean };
  peutReculer: boolean;
  peutAvancer: boolean;
}

export const PARTITION = "persist:klyra-navigateur";
/** Au plus, par conversation, et pages gardées en mémoire en même temps (les autres s'endorment). */
export const ONGLETS_PAR_CONVERSATION = 12;
const VUES_VIVANTES = 10;
/** La taille d'une page jamais montrée : un écran d'ordinateur portable. */
const TAILLE_TRAVAIL = { width: 1280, height: 800 };
const LARGEUR_VIGNETTE = 480;
const LARGEUR_CAPTURE_MAX = 1_280;
const DELAI_SCRIPT_MS = 8_000;
const DELAI_CAPTURE_CHROME_MS = 20_000;
const DELAI_CHARGEMENT_MS = 20_000;
const DUREE_PILOTE_MS = 12_000;
const TELECHARGEMENT_MAX = 1024 ** 3;
const OUBLI_MS = 30 * 24 * 3600_000;

const onglets = new Map<string, Onglet>();
let fenetre: () => BrowserWindow | null = () => null;
let signaler: (etat: OngletPublic[]) => void = () => undefined;
let montrerMenu: (id: string, menu: ParametresMenu) => void = () => undefined;
let affiche: { id: string; cadre: Electron.Rectangle } | null = null;
let fenetreSuivie: BrowserWindow | null = null;
let sessionNav: Session | null = null;
let identite: IdentiteNavigateur | null = null;
/** Les Client Hints détaillés que chaque site a demandés (`Accept-CH`), le temps que l'app est ouverte. */
const indicesParOrigine = new Map<string, Set<string>>();
const origineDe = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};
let fichierEtat = "";

/* ─── État, persistance ───────────────────────────────────────── */

function publicDe(o: Onglet): OngletPublic {
  return {
    id: o.id,
    chatId: o.chatId,
    url: o.url,
    titre: o.titre,
    chargement: o.chargement,
    peutReculer: o.peutReculer,
    peutAvancer: o.peutAvancer,
    erreur: o.erreur,
    vignette: o.vignette,
    endormi: !pageDe(o),
    affiche: affiche?.id === o.id && (!!o.vue || o.moteur === "chrome"),
    pilote: o.pilote,
    main: o.main,
    telechargements: o.telechargements,
    creeLe: o.creeLe,
    vuLe: o.vuLe,
    moteur: o.moteur,
    connexion: o.connexion,
  };
}

export function etatNavigateur(): OngletPublic[] {
  return [...onglets.values()].map(publicDe);
}

let envoi: NodeJS.Timeout | null = null;
let ecriture: NodeJS.Timeout | null = null;
function changer(persister = false): void {
  envoi ??= setTimeout(() => {
    envoi = null;
    signaler(etatNavigateur());
  }, 80);
  if (persister && fichierEtat)
    ecriture ??= setTimeout(() => {
      ecriture = null;
      const donnees = [...onglets.values()].map(({ id, chatId, url, titre, creeLe, vuLe }) => ({ id, chatId, url, titre, creeLe, vuLe }));
      const tmp = `${fichierEtat}.tmp`;
      void writeFile(tmp, JSON.stringify({ onglets: donnees }), "utf8")
        .then(() => rename(tmp, fichierEtat))
        .catch(() => undefined);
    }, 800);
}

function nouvelOnglet(chatId: string, url: string, id: string = `nav-${randomUUID()}`): Onglet {
  const maintenant = Date.now();
  return {
    id,
    chatId,
    url,
    titre: url === "about:blank" ? "Nouvel onglet" : hoteDe(url),
    chargement: false,
    peutReculer: false,
    peutAvancer: false,
    erreur: null,
    vignette: null,
    pilote: null,
    main: null,
    telechargements: [],
    creeLe: maintenant,
    vuLe: maintenant,
    moteur: moteurVoulu(),
    connexion: null,
    mainParConnexion: false,
    vue: null,
    chrome: null,
    preparation: null,
    echelle: 1,
    notes: [],
    minuteurPilote: null,
    minuteurVignette: null,
    derniereVignette: 0,
    cadres: new Map(),
    menu: null,
  };
}

/** Au lancement : les onglets de la dernière fois, endormis (aucune page chargée avant qu'on les ouvre). */
function restaurer(): void {
  try {
    if (!existsSync(fichierEtat)) return;
    const lu = JSON.parse(readFileSync(fichierEtat, "utf8")) as { onglets?: { id?: unknown; chatId?: unknown; url?: unknown; titre?: unknown; creeLe?: unknown; vuLe?: unknown }[] };
    for (const b of lu.onglets ?? []) {
      if (typeof b.id !== "string" || typeof b.chatId !== "string" || typeof b.url !== "string" || !adresseAutorisee(b.url)) continue;
      const vuLe = typeof b.vuLe === "number" ? b.vuLe : Date.now();
      if (Date.now() - vuLe > OUBLI_MS) continue;
      const o = nouvelOnglet(b.chatId, b.url, b.id);
      o.titre = typeof b.titre === "string" && b.titre ? b.titre.slice(0, 300) : o.titre;
      o.creeLe = typeof b.creeLe === "number" ? b.creeLe : vuLe;
      o.vuLe = vuLe;
      onglets.set(o.id, o);
    }
  } catch {
    /* fichier illisible : on repart sans onglet */
  }
}

/* ─── Session : identité, autorisations, téléchargements ──────── */

/**
 * L'identité de Google Chrome sur ce poste (cf. `identite.ts`) : une seule pour toute la session,
 * précisée par ce que Chromium sait du système (`navigator.userAgentData`, lu dans l'app) quand c'est possible.
 */
function identiteNavigateur(): IdentiteNavigateur {
  identite ??= identiteChrome({ versionChrome: process.versions.chrome, systeme: process.platform, arch: process.arch, versionSysteme: process.getSystemVersion() });
  return identite;
}

/**
 * Une seule lecture, dans la fenêtre de l'app une fois chargée (son protocole est sécurisé :
 * `navigator.userAgentData` y donne tout). Faite dès l'ouverture de la fenêtre, pour que la première
 * page ait déjà la bonne version du système ; sans réponse, l'identité déduite reste.
 */
let lectureNative: Promise<void> | null = null;
function lireValeursNatives(): void {
  const wc = fenetre()?.webContents;
  if (lectureNative || !wc || wc.isDestroyed() || wc.isLoading()) return;
  lectureNative = avecDelai(
    wc.executeJavaScript(`navigator.userAgentData?.getHighEntropyValues(["platformVersion", "architecture", "bitness", "wow64", "model"]) ?? null`) as Promise<Partial<MetadonneesAgent> | null>,
    2_000,
    "lecture",
  )
    .then((natif) => {
      if (natif?.platformVersion) identite = identiteChrome({ versionChrome: process.versions.chrome, systeme: process.platform, arch: process.arch, versionSysteme: process.getSystemVersion(), natif });
    })
    .catch(() => undefined);
}

function cheminLibre(dossier: string, nom: string): string {
  const ext = path.extname(nom);
  const base = path.basename(nom, ext) || "telechargement";
  let chemin = path.join(dossier, `${base}${ext}`);
  for (let i = 2; existsSync(chemin) && i < 1000; i++) chemin = path.join(dossier, `${base} (${i})${ext}`);
  return chemin;
}

function sessionNavigateur(): Session {
  if (sessionNav) return sessionNav;
  const s = sessions.fromPartition(PARTITION, { cache: true });
  s.setUserAgent(identiteNavigateur().userAgent, app.getPreferredSystemLanguages().join(",") || app.getLocale());
  // Les Client Hints, qu'Electron n'envoie pas (Chrome, si) : ceux de base partout, les détaillés aux sites qui les demandent.
  s.webRequest.onBeforeSendHeaders((details, rappel) =>
    rappel({ requestHeaders: entetesAvecIndices(details.requestHeaders, details.url, identiteNavigateur(), indicesParOrigine.get(origineDe(details.url))) }),
  );
  s.webRequest.onHeadersReceived((details, rappel) => {
    // Comme Chrome : seule la réponse d'une page (pas d'une ressource) dit ce que son site veut recevoir.
    const accept = details.resourceType === "mainFrame" ? Object.entries(details.responseHeaders ?? {}).find(([cle]) => cle.toLowerCase() === "accept-ch")?.[1] : undefined;
    if (accept) indicesParOrigine.set(origineDe(details.url), new Set(indicesDemandes(accept)));
    rappel({});
  });
  // Une seule autorisation, comme OpenBot : écrire du texte dans le presse-papiers après un clic. Ni micro, ni caméra, ni position, ni notifications.
  s.setPermissionRequestHandler((_wc, permission, rappel) => rappel(permission === "clipboard-sanitized-write"));
  s.setPermissionCheckHandler((_wc, permission) => permission === "clipboard-sanitized-write");
  s.setDevicePermissionHandler(() => false);
  s.on("will-download", (event, item, wc) => {
    const o = ongletDeContenu(wc);
    if (!o || item.getTotalBytes() > TELECHARGEMENT_MAX) {
      event.preventDefault();
      return;
    }
    const nom = path.basename(item.getFilename()).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "telechargement";
    const chemin = cheminLibre(app.getPath("downloads"), nom);
    item.setSavePath(chemin);
    const t: Telechargement = { nom: path.basename(chemin), chemin, etat: "en-cours", recus: 0, total: item.getTotalBytes() };
    o.telechargements = [t, ...o.telechargements].slice(0, 8);
    item.on("updated", () => {
      t.recus = item.getReceivedBytes();
      if (t.recus > TELECHARGEMENT_MAX) item.cancel();
      changer();
    });
    item.once("done", (_e, etat) => {
      t.etat = etat === "completed" ? "fini" : etat === "cancelled" ? "annule" : "echec";
      t.recus = item.getReceivedBytes();
      o.notes.push(etat === "completed" ? `Téléchargé : ${t.chemin}` : `Téléchargement de ${t.nom} ${etat === "cancelled" ? "annulé" : "échoué"}.`);
      changer();
    });
    changer();
  });
  sessionNav = s;
  return s;
}

const ongletDeContenu = (wc: WebContents): Onglet | undefined => [...onglets.values()].find((o) => o.vue?.webContents === wc);

/* ─── Les vues ────────────────────────────────────────────────── */

function vivante(o: Onglet): WebContents | null {
  const wc = o.vue?.webContents;
  if (!wc || wc.isDestroyed()) {
    o.vue = null;
    return null;
  }
  return wc;
}

/** Le moteur choisi dans Réglages › Navigateur, pour les pages qui s'ouvrent ou se réveillent. */
function moteurVoulu(): MoteurNavigateur {
  return lireReglages().navigateur.moteur === "chrome" ? "chrome" : "integre";
}

/** La vue intégrée (Electron), vue par les gestes des agents. */
class PageElectron implements Page {
  readonly moteur = "integre" as const;
  constructor(private wc: WebContents) {}
  detruite(): boolean {
    return this.wc.isDestroyed();
  }
  url(): string {
    return this.wc.getURL();
  }
  chargement(): boolean {
    return this.wc.isLoading();
  }
  script<T>(code: string): Promise<T> {
    return this.wc.executeJavaScriptInIsolatedWorld(MONDE_ISOLE, [{ code }]) as Promise<T>;
  }
  async cdp(methode: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const wc = this.wc;
    if (!wc.debugger.isAttached()) await brancherDebogage(wc);
    if (!pilotables.has(wc)) {
      pilotables.add(wc);
      await wc.debugger.sendCommand("Page.enable").catch(() => undefined);
      // La page se croit au premier plan : la frappe arrive même quand l'onglet n'est pas regardé.
      await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
    }
    return wc.debugger.sendCommand(methode, params);
  }
  ecouter(f: (methode: string, params: Record<string, unknown>) => void): () => void {
    const ecoute = (_e: unknown, methode: string, params: Record<string, unknown>) => f(methode, params);
    this.wc.debugger.on("message", ecoute);
    return () => this.wc.debugger.removeListener("message", ecoute);
  }
  /**
   * Une image de la page, même cachée : une vue qu'on ne regarde pas n'a pas toujours de surface à
   * capturer ; la taille de la page est alors fixée le temps de la capture (comme OpenBot).
   */
  async image(cachee: boolean): Promise<Electron.NativeImage> {
    const wc = this.wc;
    if (cachee) {
      const vue = await this.script<{ largeur: number; hauteur: number; echelle: number }>("({ largeur: innerWidth, hauteur: innerHeight, echelle: devicePixelRatio })").catch(() => null);
      if (vue?.largeur && vue.hauteur) await this.cdp("Emulation.setDeviceMetricsOverride", { width: vue.largeur, height: vue.hauteur, deviceScaleFactor: vue.echelle || 1, mobile: false }).catch(() => undefined);
    }
    try {
      return await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    } finally {
      if (cachee) await this.cdp("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    }
  }
  async cadres(): Promise<CadrePage[]> {
    return this.wc.mainFrame.frames.filter((f) => !f.detached).map((f) => this.cadreDe(f));
  }
  cadre(cle: string): CadrePage | null {
    const [processus, jeton] = cle.split(":");
    const f = webFrameMain.fromFrameToken(Number(processus), jeton);
    return f && !f.detached ? this.cadreDe(f) : null;
  }
  /** Un cadre se lit dans son monde principal : Electron n'offre pas de monde isolé à un cadre. */
  private cadreDe(f: WebFrameMain): CadrePage {
    return { cle: `${f.processId}:${f.frameToken}`, nom: f.name, url: f.url, script: <T,>(code: string) => f.executeJavaScript(code) as Promise<T> };
  }
  aller(url: string): void {
    void this.wc.loadURL(url).catch(() => undefined);
  }
  geste(g: GestePage): void {
    const wc = this.wc;
    if (g === "retour" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (g === "suivant" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (g === "recharger") wc.reload();
    else if (g === "arreter") wc.stop();
  }
}

const pagesElectron = new WeakMap<WebContents, PageElectron>();
function pageElectron(wc: WebContents): PageElectron {
  let p = pagesElectron.get(wc);
  if (!p) pagesElectron.set(wc, (p = new PageElectron(wc)));
  return p;
}

/** La page vivante de l'onglet, quel que soit son moteur (null : endormi). */
function pageDe(o: Onglet): Page | null {
  if (o.moteur === "chrome") return o.chrome && !o.chrome.detruite() ? o.chrome : null;
  const wc = vivante(o);
  return wc ? pageElectron(wc) : null;
}

/** Le moteur d'un onglet endormi suit le réglage : il se réveille dans le moteur choisi. */
function suivreMoteur(o: Onglet): void {
  if (pageDe(o) || o.preparation) return;
  o.moteur = moteurVoulu();
}

/** Chrome peut-il ouvrir un onglet d'agent maintenant ? Sinon, pourquoi. */
function verifierChrome(): void {
  if (!cheminChrome()) throw new Error(CHROME_ABSENT);
  if (modeChrome() === "personne") throw new Error(CHROME_A_LA_PERSONNE);
}

/** Les onglets de Chrome, retrouvés par leur cible. */
const ongletsChrome = new Map<string, string>();

function lierChrome(o: Onglet, p: PageChrome): void {
  o.chrome = p;
  ongletsChrome.set(p.cible, o.id);
  /* Les fenêtres de la page (alert, confirm) pendant que l'agent pilote : KLYRA répond et le lui dit. */
  p.ecouter((methode, params) => {
    if (methode !== "Page.javascriptDialogOpening" || !o.pilote) return;
    const accepter = params.type === "alert" || params.type === "beforeunload";
    void p.cdp("Page.handleJavaScriptDialog", { accept: accepter }).catch(() => undefined);
    o.notes.push(`La page a affiché ${params.type === "alert" ? "un message" : "une question"} : « ${String(params.message ?? "").slice(0, 300)} ». KLYRA a répondu ${accepter ? "OK" : "Annuler"}.`);
  });
}

/** La page de l'onglet, ouverte ou réveillée au besoin (dans Chrome : un nouvel onglet à sa dernière adresse). */
async function reveillerPage(o: Onglet): Promise<Page> {
  suivreMoteur(o);
  if (o.moteur === "integre") return pageElectron(reveiller(o));
  const deja = pageDe(o);
  if (deja) return deja;
  if (!o.preparation) {
    verifierChrome();
    o.chargement = true;
    changer();
    o.preparation = ouvrirPage(o.url)
      .then((p) => {
        lierChrome(o, p);
        if (!onglets.has(o.id)) p.fermer();
        return p as Page;
      })
      .catch((e) => {
        o.erreur = e instanceof Error ? e.message : String(e);
        o.chargement = false;
        throw e;
      })
      .finally(() => {
        o.preparation = null;
        changer(true);
      });
  }
  return o.preparation;
}

function ongletDeChrome(p: PageChrome): Onglet | undefined {
  const id = ongletsChrome.get(p.cible);
  return id ? onglets.get(id) : undefined;
}

brancherChrome({
  changement: (p) => {
    const o = ongletDeChrome(p);
    if (!o || o.chrome !== p) return;
    if (p.url()) o.url = p.url();
    o.titre = p.titre || hoteDe(o.url);
    o.chargement = p.chargement();
    o.peutReculer = p.peutReculer;
    o.peutAvancer = p.peutAvancer;
    if (!o.chargement) planifierVignette(o, 500);
    changer(true);
  },
  /* La personne a fermé l'onglet dans Chrome : l'onglet de KLYRA reste, endormi. */
  fermeture: (p) => {
    const o = ongletDeChrome(p);
    ongletsChrome.delete(p.cible);
    if (o?.chrome === p) {
      o.chrome = null;
      o.chargement = false;
      changer();
    }
  },
  /* Une fenêtre ouverte par la page devient un onglet de la même conversation (son lien avec la page reste). */
  popup: (ouvrante, nouvelle) => {
    const parent = ongletDeChrome(ouvrante);
    if (!parent || ongletsDe(parent.chatId).length >= ONGLETS_PAR_CONVERSATION) return;
    const o = nouvelOnglet(parent.chatId, nouvelle.url() || "about:blank");
    o.moteur = "chrome";
    onglets.set(o.id, o);
    lierChrome(o, nouvelle);
    parent.notes.push(`La page a ouvert un nouvel onglet (${o.id}).`);
    changer(true);
  },
  fin: (mode) => {
    for (const o of onglets.values()) {
      if (o.moteur !== "chrome") continue;
      o.chrome = null;
      o.chargement = false;
      if (mode !== "personne" || !o.connexion) continue;
      o.connexion = null;
      if (o.mainParConnexion && o.main?.type === "personne") o.main = null;
      o.mainParConnexion = false;
    }
    ongletsChrome.clear();
    changer();
  },
  telechargement: (t, etat, recus, total) => {
    const o = t.page ? ongletDeChrome(t.page) : undefined;
    let suivi = o?.telechargements.find((x) => x.chemin === t.provisoire || x.nom === t.nom && x.etat === "en-cours");
    if (etat === "debut") {
      suivi = { nom: t.nom, chemin: t.provisoire, etat: "en-cours", recus: 0, total: 0 };
      if (o) o.telechargements = [suivi, ...o.telechargements].slice(0, 8);
    }
    if (!suivi) return;
    suivi.recus = recus;
    suivi.total = total;
    if (etat === "progression" && (recus > TELECHARGEMENT_MAX || total > TELECHARGEMENT_MAX)) annulerTelechargement(t.guid);
    if (etat === "annule") suivi.etat = "annule";
    if (etat === "fini") {
      const final = cheminLibre(app.getPath("downloads"), path.basename(t.nom).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "telechargement");
      try {
        try {
          renameSync(t.provisoire, final);
        } catch {
          copyFileSync(t.provisoire, final);
          rmSync(t.provisoire, { force: true });
        }
        suivi.chemin = final;
        suivi.nom = path.basename(final);
        suivi.etat = "fini";
      } catch {
        suivi.etat = "echec";
      }
      o?.notes.push(suivi.etat === "fini" ? `Téléchargé : ${suivi.chemin}` : `Téléchargement de ${suivi.nom} échoué.`);
    }
    changer();
  },
});

function suivreFenetre(win: BrowserWindow): void {
  if (fenetreSuivie === win) return;
  fenetreSuivie = win;
  /* La fenêtre fermée (Mac garde l'app ouverte) : les pages s'endorment, les onglets restent. */
  win.once("closed", () => {
    if (fenetreSuivie === win) fenetreSuivie = null;
    for (const o of onglets.values()) {
      o.vue = null;
      o.chargement = false;
    }
    affiche = null;
    changer();
  });
}

function maj(o: Onglet, wc: WebContents): void {
  if (wc.isDestroyed()) return;
  const url = wc.getURL();
  if (url) o.url = url;
  o.titre = wc.getTitle() || hoteDe(o.url);
  o.chargement = wc.isLoading();
  o.peutReculer = wc.navigationHistory.canGoBack();
  o.peutAvancer = wc.navigationHistory.canGoForward();
  changer(true);
}

function creerVue(o: Onglet): WebContents {
  const win = fenetre();
  if (!win || win.isDestroyed()) throw new Error("La fenêtre de KLYRA est fermée : rouvre-la pour utiliser le navigateur.");
  suivreFenetre(win);
  /* Assez de pages en mémoire : la moins récemment vue (pas celle à l'écran) s'endort. */
  const vivantes = [...onglets.values()].filter((x) => x.vue && x !== o && x.id !== affiche?.id).sort((a, b) => a.vuLe - b.vuLe);
  while (vivantes.length >= VUES_VIVANTES) endormir(vivantes.shift()!);

  const vue = new WebContentsView({
    webPreferences: {
      session: sessionNavigateur(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // L'agent travaille aussi sur un onglet qu'on ne regarde pas : la page ne doit pas s'endormir.
      backgroundThrottling: false,
      safeDialogs: true,
      spellcheck: false,
    },
  });
  vue.setBackgroundColor("#FFFFFF");
  const wc = vue.webContents;
  // Avant le premier chargement : la commande part tout de suite, la navigation la suit.
  void brancherDebogage(wc).catch(() => undefined);
  lireValeursNatives();
  wc.debugger.on("detach", () => pilotables.delete(wc));
  wc.setAudioMuted(true);
  o.vue = vue;
  win.contentView.addChildView(vue);
  // Une page jamais montrée a besoin d'une taille pour se dessiner (et être capturée).
  vue.setVisible(true);
  vue.setBounds({ x: 0, y: 0, ...TAILLE_TRAVAIL });
  vue.setVisible(false);

  const suivre = () => maj(o, wc);
  wc.on("did-start-loading", () => {
    o.erreur = null;
    suivre();
  });
  wc.on("did-stop-loading", () => {
    suivre();
    planifierVignette(o, 500);
  });
  wc.on("page-title-updated", suivre);
  wc.on("did-navigate", suivre);
  wc.on("did-navigate-in-page", suivre);
  wc.on("did-fail-load", (_e, code, description, url, principal) => {
    if (!principal || code === -3) return; // -3 : chargement interrompu (une autre navigation), pas une erreur
    o.erreur = `${description || "La page ne s’est pas chargée"} (${code})`;
    if (url) o.url = url;
    changer(true);
  });
  wc.on("render-process-gone", (_e, d) => {
    o.erreur = d.reason === "clean-exit" ? null : "La page s’est arrêtée. Recharge-la.";
    changer();
  });
  /* Seulement des pages web, dans le cadre principal comme dans les cadres. */
  const bloquer = (e: { preventDefault: () => void; url: string }) => {
    if (!adresseAutorisee(e.url)) {
      e.preventDefault();
      if (/^(mailto|tel):/i.test(e.url)) o.notes.push(`La page voulait ouvrir ${e.url.split(":")[0]} : KLYRA ne l’a pas fait.`);
    }
  };
  wc.on("will-navigate", bloquer);
  wc.on("will-redirect", bloquer);
  wc.on("will-frame-navigate", bloquer);
  /* Échap dans la page : retour aux vignettes. La page ne le reçoit pas. */
  wc.on("before-input-event", (event, input) => {
    if ((input.type !== "keyDown" && input.type !== "rawKeyDown") || input.key !== "Escape" || input.isAutoRepeat) return;
    if (input.alt || input.control || input.meta || input.shift) return;
    if (affiche?.id !== o.id) return;
    event.preventDefault();
    const cible = fenetre()?.webContents;
    if (cible && !cible.isDestroyed()) cible.send("navigateur:echap", o.id);
  });
  /* Le clic droit de la personne : le menu de l'app, dessiné par l'écran (pas celui d'un clic droit de l'agent). */
  wc.on("context-menu", (_e, p) => {
    if (o.pilote && Date.now() - o.pilote.at < 2_000) return;
    if (affiche?.id !== o.id) return;
    const lien = adresseAutorisee(p.linkURL) && p.linkURL !== "about:blank" ? p.linkURL : null;
    o.menu = {
      x: p.x,
      y: p.y,
      lien,
      texteLien: (p.linkText || "").slice(0, 120),
      image: p.mediaType === "image" && adresseAutorisee(p.srcURL) ? p.srcURL : null,
      selection: (p.selectionText || "").trim().slice(0, 500),
      editable: p.isEditable,
      peut: { couper: p.editFlags.canCut, copier: p.editFlags.canCopy, coller: p.editFlags.canPaste, toutSelectionner: p.editFlags.canSelectAll },
      peutReculer: wc.navigationHistory.canGoBack(),
      peutAvancer: wc.navigationHistory.canGoForward(),
    };
    // La vignette d'abord : la page s'efface derrière elle tant que le menu est ouvert.
    void vignette(o).finally(() => {
      fenetre()?.webContents.focus();
      if (o.menu) montrerMenu(o.id, o.menu);
    });
  });
  /* Une fenêtre ouverte par la page devient un onglet de la même conversation. */
  wc.setWindowOpenHandler(({ url }) => {
    if (adresseAutorisee(url) && url !== "about:blank") {
      try {
        const nouvel = ouvrirOnglet(o.chatId, url);
        o.notes.push(`La page a ouvert un nouvel onglet (${nouvel.id}) : ${url}`);
      } catch (e) {
        o.notes.push(e instanceof Error ? e.message : String(e));
      }
    }
    return { action: "deny" };
  });
  /* Les fenêtres de la page (alert, confirm) pendant que l'agent pilote : KLYRA répond et le lui dit. */
  wc.debugger.on("message", (_e, methode, params: { type?: string; message?: string }) => {
    if (methode !== "Page.javascriptDialogOpening" || !o.pilote) return;
    const accepter = params.type === "alert" || params.type === "beforeunload";
    void wc.debugger.sendCommand("Page.handleJavaScriptDialog", { accept: accepter }).catch(() => undefined);
    o.notes.push(`La page a affiché ${params.type === "alert" ? "un message" : "une question"} : « ${String(params.message ?? "").slice(0, 300)} ». KLYRA a répondu ${accepter ? "OK" : "Annuler"}.`);
  });
  return wc;
}

/** Les pages où un agent a déjà agi : le protocole y écoute aussi les fenêtres de la page et garde le focus. */
const pilotables = new WeakSet<WebContents>();

/**
 * Le protocole de débogage, branché dès la création de la page : il porte l'identité de Chrome
 * jusque dans la page (`navigator.userAgentData`), ce que `session.setUserAgent` ne fait pas.
 * Rien d'autre tant qu'aucun agent n'agit (cf. `cdp`).
 */
async function brancherDebogage(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  const id = identiteNavigateur();
  await wc.debugger.sendCommand("Emulation.setUserAgentOverride", { userAgent: id.userAgent, userAgentMetadata: id.metadonnees }).catch(() => undefined);
}

function endormir(o: Onglet): void {
  const vue = o.vue;
  o.vue = null;
  o.chargement = false;
  if (!vue) return;
  const win = fenetreSuivie;
  if (win && !win.isDestroyed()) win.contentView.removeChildView(vue);
  if (!vue.webContents.isDestroyed()) vue.webContents.close();
  changer();
}

/** La page de l'onglet, réveillée au besoin (chargée à sa dernière adresse). */
function reveiller(o: Onglet): WebContents {
  const deja = vivante(o);
  if (deja) return deja;
  const wc = creerVue(o);
  void wc.loadURL(o.url).catch(() => undefined);
  maj(o, wc);
  return wc;
}

/** Pose l'onglet montré à l'endroit réservé par l'écran ; les autres sont cachés (et muets). */
function appliquerAffichage(): void {
  const win = fenetre();
  for (const o of onglets.values()) {
    const vue = o.vue;
    if (!vue || vue.webContents.isDestroyed()) continue;
    const montre = !!affiche && affiche.id === o.id && !!win && !win.isDestroyed();
    if (montre) {
      const zoom = win!.webContents.getZoomFactor();
      const c = affiche!.cadre;
      vue.setBounds({ x: Math.round(c.x * zoom), y: Math.round(c.y * zoom), width: Math.max(1, Math.round(c.width * zoom)), height: Math.max(1, Math.round(c.height * zoom)) });
      win!.contentView.addChildView(vue); // remise au premier plan
      vue.setVisible(true);
      vue.webContents.setAudioMuted(false);
    } else if (vue.getVisible()) {
      vue.setVisible(false);
      vue.webContents.setAudioMuted(true);
      planifierVignette(o, 0);
    }
  }
}

/**
 * Le test d'écran envoie Échap comme une vraie frappe sur la page affichée.
 * Le protocole de débogage ne passe pas par `before-input-event` : seul cet
 * envoi-là le fait. Refusé hors du test.
 */
export function injecterEchap(): boolean {
  if (process.env.KLYRA_NAVIGATEUR_TEST !== "1") return false;
  const o = affiche ? onglets.get(affiche.id) : undefined;
  const wc = o?.vue?.webContents;
  if (!wc || wc.isDestroyed()) return false;
  wc.focus();
  wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  return true;
}

/** L'écran montre cet onglet dans ce cadre (en pixels CSS de la fenêtre), ou plus aucun. */
export function afficherOnglet(id: string | null, cadre: Electron.Rectangle | null): void {
  if (!id || !cadre || ![cadre.x, cadre.y, cadre.width, cadre.height].every(Number.isFinite) || cadre.width < 2 || cadre.height < 2) {
    const avant = affiche;
    affiche = null;
    appliquerAffichage();
    if (avant) changer();
    return;
  }
  const o = exiger(id);
  suivreMoteur(o);
  // Dans Chrome, l'onglet que la personne regarde dans KLYRA passe devant dans sa fenêtre.
  if (o.moteur === "integre") reveiller(o);
  else if (modeChrome() !== "personne")
    void reveillerPage(o)
      .then((p) => (p as PageChrome).devant())
      .catch(() => undefined);
  o.vuLe = Date.now();
  affiche = { id, cadre: { x: cadre.x, y: cadre.y, width: cadre.width, height: cadre.height } };
  appliquerAffichage();
  if (o.moteur === "chrome") planifierVignette(o, 0);
  changer(true);
}

/* ─── Vignettes ───────────────────────────────────────────────── */

/** Dans Chrome, la page n'est pas dans le panneau : sa vignette s'y relit tant qu'on la regarde. */
const RELECTURE_CHROME_MS = 2_500;

function planifierVignette(o: Onglet, delai: number): void {
  if (o.minuteurVignette) return;
  o.minuteurVignette = setTimeout(() => {
    o.minuteurVignette = null;
    void vignette(o).finally(() => {
      if (o.moteur === "chrome" && affiche?.id === o.id && onglets.has(o.id) && pageDe(o)) planifierVignette(o, RELECTURE_CHROME_MS);
    });
  }, Math.max(delai, 1_200 - (Date.now() - o.derniereVignette)));
}

async function vignette(o: Onglet): Promise<void> {
  const page = pageDe(o);
  if (!page || page.chargement()) return;
  try {
    const image = await imagePage(o, page);
    if (image.isEmpty()) return;
    const { width } = image.getSize();
    o.vignette = `data:image/jpeg;base64,${(width > LARGEUR_VIGNETTE ? image.resize({ width: LARGEUR_VIGNETTE, quality: "good" }) : image).toJPEG(62).toString("base64")}`;
    o.derniereVignette = Date.now();
    changer();
  } catch {
    /* page fermée entre-temps */
  }
}

/* ─── Onglets : ouvrir, aller, fermer ─────────────────────────── */

function exiger(id: string): Onglet {
  const o = onglets.get(String(id));
  if (!o) throw new Error("Cet onglet n’existe plus.");
  return o;
}

export function ongletsDe(chatId: string): Onglet[] {
  return [...onglets.values()].filter((o) => o.chatId === chatId).sort((a, b) => a.creeLe - b.creeLe);
}

export function ouvrirOnglet(chatId: string, saisie = "about:blank"): Onglet {
  if (!chatId) throw new Error("Conversation inconnue.");
  if (ongletsDe(chatId).length >= ONGLETS_PAR_CONVERSATION) throw new Error(`Déjà ${ONGLETS_PAR_CONVERSATION} onglets dans cette conversation : ferme ceux qui ne servent plus.`);
  const url = normaliserAdresse(saisie);
  const o = nouvelOnglet(chatId, url);
  if (o.moteur === "chrome") verifierChrome();
  onglets.set(o.id, o);
  try {
    if (o.moteur === "chrome") void reveillerPage(o).catch(() => undefined);
    else {
      const wc = creerVue(o);
      void wc.loadURL(url).catch(() => undefined);
      maj(o, wc);
    }
  } catch (e) {
    onglets.delete(o.id);
    throw e;
  }
  changer(true);
  return o;
}

export function allerA(id: string, saisie: string): void {
  const o = exiger(id);
  const url = normaliserAdresse(saisie);
  o.erreur = null;
  o.vuLe = Date.now();
  suivreMoteur(o);
  if (o.moteur === "integre") pageElectron(reveiller(o)).aller(url);
  else {
    const deja = pageDe(o);
    if (deja) deja.aller(url);
    else {
      o.url = url; // la page se réveille à cette adresse
      void reveillerPage(o).catch(() => undefined);
    }
  }
  changer(true);
}

export type GesteHistorique = "retour" | "suivant" | "recharger" | "arreter";

export function historique(id: string, geste: GesteHistorique): void {
  const o = exiger(id);
  void reveillerPage(o)
    .then((p) => p.geste(geste))
    .catch(() => undefined);
}

export function fermerOnglet(id: string): void {
  const o = onglets.get(String(id));
  if (!o) return;
  if (affiche?.id === id) affiche = null;
  endormir(o);
  if (o.chrome) {
    ongletsChrome.delete(o.chrome.cible);
    o.chrome.fermer();
    o.chrome = null;
  }
  if (o.minuteurPilote) clearTimeout(o.minuteurPilote);
  if (o.minuteurVignette) clearTimeout(o.minuteurVignette);
  onglets.delete(o.id);
  changer(true);
}

/** La personne prend la main (l'agent n'agit plus sur cet onglet), ou la rend. */
export function prendreLaMain(id: string, prise: boolean): void {
  const o = exiger(id);
  o.main = prise ? { type: "personne" } : null;
  if (prise) o.pilote = null;
  changer();
}

/** L'adresse de l'onglet, dans le navigateur de la personne. */
export async function ouvrirAilleurs(id: string): Promise<void> {
  const o = exiger(id);
  if (!/^https?:/i.test(o.url)) throw new Error("Rien à ouvrir.");
  await shell.openExternal(o.url);
}

/** Montre un fichier téléchargé par le navigateur (seulement ceux-là). */
export function montrerTelechargement(chemin: string): void {
  const connu = [...onglets.values()].some((o) => o.telechargements.some((t) => t.chemin === chemin && t.etat === "fini"));
  if (!connu || !existsSync(chemin)) throw new Error("Ce fichier n’est plus là.");
  shell.showItemInFolder(chemin);
}

/** Réglages › Navigateur : cookies, connexions, cache, tout ce que les sites ont gardé. */
export async function effacerDonnees(): Promise<void> {
  const s = sessionNavigateur();
  await s.clearStorageData();
  await s.clearCache();
  await s.clearAuthCache();
  indicesParOrigine.clear();
  for (const o of onglets.values()) if (vivante(o)) o.vue!.webContents.reload();
  await effacerProfilChrome();
}

/* ─── Chrome de ce poste : la personne s'y connecte elle-même ─── */

/**
 * La personne se connecte dans Chrome, depuis cet onglet : Chrome se rouvre sans pilotage sur sa
 * page (Google refuse une connexion dans un navigateur piloté). Les agents attendent qu'elle ait fini.
 */
export async function connexionDansChrome(id: string): Promise<void> {
  const o = exiger(id);
  if (o.moteur !== "chrome") throw new Error("Cet onglet est dans le navigateur intégré : choisis « Chrome de ce poste » dans Réglages › Navigateur.");
  if (!cheminChrome()) throw new Error(CHROME_ABSENT);
  const url = pageDe(o)?.url() || o.url;
  for (const x of onglets.values()) x.connexion = null;
  o.connexion = "ouverte";
  o.mainParConnexion = o.main === null;
  if (o.main === null) o.main = { type: "personne" };
  o.pilote = null;
  changer();
  try {
    await ouvrirPourLaPersonne(url);
  } catch (e) {
    o.connexion = null;
    if (o.mainParConnexion) o.main = null;
    o.mainParConnexion = false;
    changer();
    throw e;
  }
}

/**
 * La personne a fini de se connecter. Sous Windows, Chrome se ferme comme d'un clic sur la croix ;
 * ailleurs, elle le ferme elle-même (`a-fermer`), et sa fermeture rend la main (cf. `fin`).
 */
export async function connexionTerminee(id: string): Promise<"ferme" | "a-fermer"> {
  const o = onglets.get(String(id));
  const etat = await terminerPourLaPersonne();
  if (o && etat === "a-fermer" && o.connexion) o.connexion = "a-fermer";
  if (o && etat === "ferme") {
    o.connexion = null;
    if (o.mainParConnexion && o.main?.type === "personne") o.main = null;
    o.mainParConnexion = false;
    o.erreur = null;
  }
  changer();
  return etat;
}

/** Montre l'onglet dans la fenêtre de Chrome (la personne veut voir ou faire elle-même). */
export async function montrerDansChrome(id: string): Promise<void> {
  const o = exiger(id);
  if (o.moteur !== "chrome") throw new Error("Cet onglet est dans le navigateur intégré.");
  const p = (await reveillerPage(o)) as PageChrome;
  await p.activer();
}

/* ─── Pour les agents ─────────────────────────────────────────── */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function avecDelai<T>(promesse: Promise<T>, ms: number, message: string): Promise<T> {
  let minuteur: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promesse, new Promise<never>((_, rejeter) => (minuteur = setTimeout(() => rejeter(new Error(message)), ms)))]);
  } finally {
    clearTimeout(minuteur);
  }
}

/** Un script dans le monde isolé de la page. */
async function script<T>(page: Page, code: string): Promise<T> {
  return avecDelai(
    page.script<T>(code),
    DELAI_SCRIPT_MS,
    "La page ne répond pas (elle charge encore, ou attend une réponse dans une fenêtre). Réessaie dans un instant ou regarde-la avec navigateur_capture.",
  );
}

/** Une commande du protocole de la page (le premier geste prépare la page à être pilotée). */
function cdp(page: Page, methode: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return page.cdp(methode, params);
}

/** Une image de la page, même quand on ne la regarde pas. */
async function imagePage(o: Onglet, page: Page): Promise<Electron.NativeImage> {
  // Chrome capture un onglet de fond en quelques secondes (il le rend visible le temps de l'image).
  return avecDelai(page.image(o.moteur === "integre" && !o.vue?.getVisible()), page.moteur === "chrome" ? DELAI_CAPTURE_CHROME_MS : DELAI_SCRIPT_MS, "La capture n’a pas abouti.");
}

/** L'onglet sur lequel un agent travaille : celui qu'il nomme (de sa conversation), sinon le dernier qu'on a utilisé. */
export function ongletPourAgent(chatId: string, id?: unknown): Onglet {
  if (typeof id === "string" && id) {
    const o = onglets.get(id);
    if (!o || o.chatId !== chatId) throw new Error(`Aucun onglet « ${id} » dans cette conversation : navigateur_onglets les liste.`);
    return o;
  }
  const dernier = ongletsDe(chatId).sort((a, b) => b.vuLe - a.vuLe)[0];
  if (!dernier) throw new Error("Aucun onglet ouvert dans cette conversation : ouvre une page avec navigateur_aller.");
  return dernier;
}

/** Réveille la page et vérifie que l'agent peut agir (la personne n'a pas la main). */
export async function pageDeLAgent(o: Onglet, roleId: string, action: string, agir: boolean): Promise<Page> {
  if (agir && o.main?.type === "personne") throw new Error("La personne a repris la main sur cet onglet : n’y agis plus. Demande-lui dans la conversation quand tu peux continuer.");
  if (agir && o.main?.type === "demandee") throw new Error(`Tu as passé la main à la personne (${o.main.raison}) : attends qu’elle te dise que c’est fait.`);
  const page = await reveillerPage(o);
  o.vuLe = Date.now();
  o.pilote = { roleId, action, at: Date.now() };
  if (o.minuteurPilote) clearTimeout(o.minuteurPilote);
  o.minuteurPilote = setTimeout(() => {
    o.pilote = null;
    o.minuteurPilote = null;
    changer();
  }, DUREE_PILOTE_MS);
  changer(true);
  return page;
}

/** L'agent passe la main à la personne (connexion, code, CAPTCHA, paiement). */
export function passerLaMain(o: Onglet, roleId: string, raison: string): void {
  o.main = { type: "demandee", roleId, raison: raison.slice(0, 200) || "à toi de jouer" };
  o.pilote = null;
  changer();
}

/** Ce que la page a dit depuis la dernière action (fenêtres, téléchargements, onglets ouverts). */
export function prendreNotes(o: Onglet): string[] {
  const notes = o.notes;
  o.notes = [];
  return notes;
}

/** Attend la fin d'un chargement lancé par une action (au plus `ms`), puis un court calme. */
export async function attendreCalme(page: Page, ms = DELAI_CHARGEMENT_MS): Promise<void> {
  await pause(150);
  const limite = Date.now() + ms;
  while (!page.detruite() && page.chargement() && Date.now() < limite) await pause(100);
  await pause(250);
}

/** Un script dans un cadre de la page. */
async function scriptCadre<T>(cadre: CadrePage, code: string): Promise<T> {
  return avecDelai(cadre.script<T>(code), DELAI_SCRIPT_MS, "Le cadre ne répond pas : regarde la page avec navigateur_capture.");
}

function cadreDe(o: Onglet, page: Page, prefixe: string): { cadre: CadrePage; refIframe: string } {
  const c = o.cadres.get(prefixe);
  const cadre = c ? page.cadre(c.cle) : null;
  if (!c || !cadre) throw new Error(`Le cadre ${prefixe} a changé : relis la page avec navigateur_lire.`);
  return { cadre, refIframe: c.refIframe };
}

/** Un script dans la page, ou dans le cadre d'où vient la référence (c1e4). */
async function scriptPour<T>(o: Onglet, page: Page, ref: string | null, fabrique: (ref: string | null) => string): Promise<T> {
  const d = ref ? decouperRef(ref) : { cadre: null, ref: null };
  if (!d.cadre) return script<T>(page, fabrique(d.ref));
  return scriptCadre<T>(cadreDe(o, page, d.cadre).cadre, fabrique(d.ref));
}

const CADRES_LUS_MAX = 6;

/**
 * La page, puis ses cadres directs (paiement, connexion, contenu intégré), chacun avec des
 * références préfixées (c1e4). Un cadre est rapproché de son élément iframe par son nom, son
 * adresse, ou son rang quand les deux listes ont la même longueur.
 */
export async function lireInstantane(o: Onglet, pg: Page): Promise<InstantanePage> {
  const page = await script<InstantanePage>(pg, SCRIPT_INSTANTANE);
  o.cadres.clear();
  const iframes = page.iframes ?? [];
  const enfants = await pg.cadres();
  const lus: CadreLu[] = [];
  for (const [rang, cadre] of enfants.entries()) {
    if (lus.length >= CADRES_LUS_MAX) break;
    if (!/^https?:/i.test(cadre.url)) continue;
    const el =
      (cadre.nom && iframes.find((x) => x.nom === cadre.nom)) ||
      iframes.find((x) => x.src && x.src === cadre.url) ||
      (enfants.length === iframes.length ? iframes[rang] : undefined);
    if (!el || !el.visible) continue;
    const prefixe = `c${lus.length + 1}`;
    try {
      const lu = await scriptCadre<InstantanePage>(cadre, scriptInstantane(prefixe));
      o.cadres.set(prefixe, { cle: cadre.cle, refIframe: el.ref });
      lus.push({ prefixe, origine: hoteDe(cadre.url), elements: lu.elements ?? [], texte: String(lu.texte ?? "").slice(0, 600) });
    } catch {
      /* cadre qui ne répond pas : compté comme non lu */
    }
  }
  return { ...page, cadresLus: lus };
}

export async function lireTexte(page: Page): Promise<string> {
  return script<string>(page, SCRIPT_TEXTE);
}

/** Attend qu'un texte apparaisse dans la page (au plus `ms`). */
export async function attendreTexte(page: Page, texte: string, ms: number): Promise<boolean> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await script<boolean>(page, scriptContient(texte)).catch(() => false)) return true;
    await pause(300);
  }
  return false;
}

async function curseur(page: Page, x: number, y: number): Promise<void> {
  await script(page, scriptCurseur(x, y)).catch(() => undefined);
}

/** Les coordonnées d'un élément (`eN`) ou d'un point de la dernière capture, en pixels de la page. */
export async function viser(o: Onglet, wc: Page, cible: { ref?: string; x?: number; y?: number }): Promise<{ x: number; y: number; note: string | null; protege: boolean }> {
  if (cible.ref) {
    type Cible = { ok: boolean; raison?: string; x: number; y: number; protege: boolean; desactive: boolean; recouvert: string | null; nom: string };
    const d = decouperRef(cible.ref);
    let r: Cible;
    let decalage = { x: 0, y: 0 };
    if (d.cadre) {
      /* Dans un cadre : l'élément centré dans le cadre, le cadre amené à l'écran, puis le point dans la page. */
      const { cadre, refIframe } = cadreDe(o, wc, d.cadre);
      type Place = { x: number; y: number; hauteurVue: number } | null;
      let place = await script<Place>(wc, scriptPlaceCadre(refIframe));
      if (!place) throw new Error(`Le cadre ${d.cadre} a disparu de la page : relis-la.`);
      r = await scriptCadre<Cible>(cadre, scriptCible(d.ref));
      if (r.ok && (place.y + r.y < 0 || place.y + r.y > place.hauteurVue)) {
        place = (await script<Place>(wc, scriptPlaceCadre(refIframe, place.y + r.y - place.hauteurVue / 2))) ?? place;
      }
      decalage = { x: place.x, y: place.y };
    } else r = await script<Cible>(wc, scriptCible(d.ref));
    if (!r.ok) throw new Error(r.raison);
    const notes = [r.desactive ? "l’élément est désactivé" : "", r.recouvert ? `un autre élément le recouvre (« ${r.recouvert} »)` : ""].filter(Boolean);
    return { x: Math.round(decalage.x + r.x), y: Math.round(decalage.y + r.y), protege: r.protege, note: notes.length ? `Attention : ${notes.join(", ")}.` : null };
  }
  if (typeof cible.x === "number" && typeof cible.y === "number" && Number.isFinite(cible.x) && Number.isFinite(cible.y)) {
    return { x: Math.round(cible.x * o.echelle), y: Math.round(cible.y * o.echelle), protege: false, note: null };
  }
  throw new Error("Vise un élément par sa référence (ref, ex. e12, lue avec navigateur_lire) ou un point (x et y de la dernière capture).");
}

export async function cliquer(wc: Page, x: number, y: number, options: { double?: boolean; bouton?: "left" | "right" | "middle" } = {}): Promise<void> {
  const bouton = options.bouton ?? "left";
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  void curseur(wc, x, y);
  for (let n = 1; n <= (options.double ? 2 : 1); n++) {
    await cdp(wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: bouton, clickCount: n });
    await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: bouton, clickCount: n });
  }
}

export async function survoler(wc: Page, x: number, y: number): Promise<void> {
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

export async function appuyer(wc: Page, combinaison: string): Promise<void> {
  for (const e of evenementsTouche(combinaison)) await cdp(wc, "Input.dispatchKeyEvent", { ...e });
}

/**
 * Tape un texte dans l'élément visé (ou celui qui a le focus). Jamais dans un
 * mot de passe, un code à usage unique ou un champ de carte.
 */
export async function taper(o: Onglet, wc: Page, ref: string | null, texte: string, effacer: boolean): Promise<string | null> {
  /* Dans un cadre, le focus y entre par un vrai clic ; la frappe va ensuite au cadre qui a le focus. */
  if (ref && decouperRef(ref).cadre) {
    const c = await viser(o, wc, { ref });
    await cliquer(wc, c.x, c.y);
  }
  const f = await scriptPour<{ ok: boolean; raison?: string; editable: boolean; protege: boolean; avant?: string }>(o, wc, ref, (r) => scriptFocus(r, effacer));
  if (!f.ok) throw new Error(f.raison);
  if (f.protege) throw new Error("Champ protégé (mot de passe, code ou carte) : tu ne le remplis jamais. Passe la main à la personne (navigateur_agir, action passer_la_main) pour qu’elle le remplisse.");
  await cdp(wc, "Input.insertText", { text: texte });
  if (!f.editable) return "Aucun champ n’avait le focus : le texte est parti au clavier vers la page.";
  const apres = await scriptPour<string | null>(o, wc, ref, () => SCRIPT_VALEUR_FOCUS).catch(() => null);
  if (apres !== null && texte && !apres.includes(texte.slice(0, 40)) && apres === (effacer ? "" : f.avant)) return "Le champ ne semble pas avoir reçu le texte : relis la page.";
  return null;
}

export async function choisir(o: Onglet, wc: Page, ref: string, valeur: string): Promise<string> {
  const r = await scriptPour<{ ok: boolean; raison?: string; choisi?: string }>(o, wc, ref, (x) => scriptChoisir(x ?? "", valeur));
  if (!r.ok) throw new Error(r.raison);
  return r.choisi ?? valeur;
}

export async function defiler(o: Onglet, wc: Page, ref: string | null, dx: number, dy: number): Promise<{ y: number; bouge: boolean; max: number }> {
  const r = await scriptPour<{ ok: boolean; raison?: string; y: number; bouge: boolean; max: number }>(o, wc, ref, (x) => scriptDefiler(x, dx, dy));
  if (!r.ok) throw new Error(r.raison);
  return r;
}

/** La partie visible de la page, en JPEG, réduite à 1 280 px de large au plus. */
export async function capturer(o: Onglet, wc: Page): Promise<{ base64: string; largeur: number; hauteur: number; echelle: number }> {
  await attendreCalme(wc, 5_000);
  const image = await imagePage(o, wc);
  if (image.isEmpty()) throw new Error("La page n’a encore rien affiché.");
  const vue = await script<{ largeur: number }>(wc, "({ largeur: innerWidth })").catch(() => null);
  const taille = image.getSize();
  const largeurPage = vue?.largeur || taille.width;
  const largeur = Math.min(LARGEUR_CAPTURE_MAX, largeurPage);
  const reduite = taille.width !== largeur ? image.resize({ width: largeur, quality: "good" }) : image;
  o.echelle = largeurPage / largeur;
  const t = reduite.getSize();
  planifierVignette(o, 0);
  return { base64: reduite.toJPEG(75).toString("base64"), largeur: t.width, hauteur: t.height, echelle: o.echelle };
}

/* ─── Envoyer des fichiers ────────────────────────────────────── */

export const FICHIERS_MAX = 10;
const FICHIER_TAILLE_MAX = 100 * 1024 * 1024;

/** Des fichiers de ce poste : chemins complets, qui existent, 100 Mo au plus chacun. */
export function verifierFichiers(brut: unknown): string[] {
  const liste = Array.isArray(brut) ? brut : typeof brut === "string" ? [brut] : [];
  const chemins = liste.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (!chemins.length) throw new Error("Donne les chemins complets des fichiers (chemins).");
  if (chemins.length > FICHIERS_MAX) throw new Error(`${FICHIERS_MAX} fichiers au plus à la fois.`);
  for (const c of chemins) {
    if (!path.isAbsolute(c)) throw new Error(`Donne le chemin complet, pas « ${c} ».`);
    let taille: number;
    try {
      const st = statSync(c);
      if (!st.isFile()) throw new Error("dossier");
      taille = st.size;
    } catch {
      throw new Error(`Aucun fichier à ${c}.`);
    }
    if (taille > FICHIER_TAILLE_MAX) throw new Error(`${path.basename(c)} est trop lourd (100 Mo au plus).`);
  }
  return chemins;
}

/**
 * Donne des fichiers à un champ « fichier » de la page, ou au choix de fichiers qu'ouvre un bouton
 * (le choix est intercepté : aucune fenêtre du système ne s'ouvre).
 */
export async function envoyerFichiers(o: Onglet, wc: Page, ref: string, brut: unknown): Promise<string> {
  const chemins = verifierFichiers(brut);
  if (decouperRef(ref).cadre) throw new Error("Envoyer des fichiers dans un cadre n’est pas possible : passe la main à la personne pour cette étape.");
  const marque = randomUUID();
  const r = await script<{ ok: boolean; raison?: string; champ: boolean; multiple: boolean }>(wc, scriptFichier(ref, marque));
  if (!r.ok) throw new Error(r.raison);
  if (!r.multiple && chemins.length > 1) throw new Error("Ce champ n’accepte qu’un fichier.");
  const noms = chemins.map((c) => path.basename(c)).join(", ");
  if (r.champ) {
    try {
      const doc = (await cdp(wc, "DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
      const trouve = (await cdp(wc, "DOM.querySelector", { nodeId: doc.root.nodeId, selector: `[data-klyra-fichier="${marque}"]` })) as { nodeId: number };
      if (!trouve.nodeId) throw new Error("Champ introuvable (dans un composant isolé) : vise plutôt le bouton qui ouvre le choix de fichiers.");
      await cdp(wc, "DOM.setFileInputFiles", { files: chemins, nodeId: trouve.nodeId });
    } finally {
      await script(wc, scriptDemarquerFichier(marque)).catch(() => undefined);
    }
    return `Fichiers donnés au champ ${ref} : ${noms}`;
  }
  await cdp(wc, "Page.setInterceptFileChooserDialog", { enabled: true });
  try {
    const ouvert = new Promise<{ backendNodeId: number; mode: string } | null>((resoudre) => {
      const arreter = wc.ecouter((methode, params) => {
        if (methode !== "Page.fileChooserOpened") return;
        clearTimeout(minuteur);
        arreter();
        resoudre(params as { backendNodeId: number; mode: string });
      });
      const minuteur = setTimeout(() => {
        arreter();
        resoudre(null);
      }, 5_000);
    });
    const c = await viser(o, wc, { ref });
    await cliquer(wc, c.x, c.y);
    const choix = await ouvert;
    if (!choix) throw new Error("Aucun choix de fichiers ne s’est ouvert en cliquant sur cet élément : vise le champ ou le bouton « Joindre ».");
    if (choix.mode === "selectSingle" && chemins.length > 1) throw new Error("Ce choix n’accepte qu’un fichier.");
    await cdp(wc, "DOM.setFileInputFiles", { files: chemins, backendNodeId: choix.backendNodeId });
  } finally {
    await cdp(wc, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => undefined);
  }
  return `Fichiers donnés par ${ref} : ${noms}`;
}

/* ─── Coffre : remplir une connexion ──────────────────────────── */

/** Les connexions du coffre qui valent pour la page de cet onglet. */
export function connexionsDeLOnglet(o: Onglet, parAgent: boolean): ConnexionCoffre[] {
  return connexionsPour(pageDe(o)?.url() || o.url, parAgent);
}

/**
 * Remplit la connexion de la page avec le coffre : par la personne (d'un clic) ou par un agent
 * (seulement les connexions qu'elle lui permet). Le mot de passe ne passe que par la page de son site.
 */
export async function remplirConnexion(
  o: Onglet,
  wc: Page,
  choix: { id?: string | null; identifiant?: string | null; refIdentifiant?: string | null; refMotDePasse?: string | null; valider?: boolean; parAgent: boolean },
): Promise<string> {
  const url = wc.url();
  const dispo = connexionsPour(url, choix.parAgent);
  const voulu = choix.identifiant?.trim().toLowerCase();
  const candidates = choix.id ? dispo.filter((c) => c.id === choix.id) : voulu ? dispo.filter((c) => c.identifiant.toLowerCase() === voulu) : dispo;
  if (!candidates.length)
    throw new Error(
      dispo.length
        ? `Aucune connexion « ${choix.identifiant} » pour ce site. Enregistrées : ${dispo.map((c) => c.identifiant || "(sans identifiant)").join(", ")}.`
        : `Aucune connexion enregistrée${choix.parAgent ? " pour les agents" : ""} pour ${hoteDe(url)} : passe la main à la personne (passer_la_main) pour qu’elle se connecte.`,
    );
  if (candidates.length > 1) throw new Error(`Plusieurs connexions pour ce site : précise identifiant (${candidates.map((c) => c.identifiant).join(", ")}).`);
  for (const r of [choix.refIdentifiant, choix.refMotDePasse]) if (r && decouperRef(r).cadre) throw new Error("Une connexion dans un cadre se remplit par la personne : passe-lui la main.");
  const secret = secretPour(candidates[0].id, url, choix.parAgent);
  const r = await script<{ ok: boolean; raison?: string; identifiant: boolean }>(
    wc,
    scriptRemplirConnexion({ refIdentifiant: choix.refIdentifiant, refMotDePasse: choix.refMotDePasse, identifiant: secret.identifiant, motDePasse: secret.motDePasse }),
  );
  if (!r.ok) throw new Error(r.raison);
  if (choix.valider) {
    await pause(120);
    await appuyer(wc, "Enter");
  }
  return `Connexion « ${secret.identifiant || "sans identifiant"} » remplie pour ${secret.hote}${r.identifiant ? "" : " (mot de passe seul : aucun champ d’identifiant trouvé)"}${choix.valider ? ", puis validée" : ""}.`;
}

/** La personne remplit la connexion de l'onglet affiché, d'un clic, avec une entrée du coffre. */
export async function remplirParLaPersonne(id: string, idConnexion: string): Promise<string> {
  const o = exiger(id);
  return remplirConnexion(o, await reveillerPage(o), { id: idConnexion, parAgent: false });
}

/* ─── Menu du clic droit ──────────────────────────────────────── */

export type ActionMenu = "retour" | "suivant" | "recharger" | "couper" | "copier" | "coller" | "tout" | "copier-lien" | "lien-onglet" | "lien-ailleurs" | "image-onglet" | "copier-image" | "chercher";

/** Une ligne du menu choisie : elle ne vaut que pour le dernier menu ouvert sur cet onglet. */
export async function actionMenu(id: string, action: ActionMenu): Promise<void> {
  const o = exiger(id);
  const m = o.menu;
  const wc = vivante(o);
  if (!m || !wc) throw new Error("Ce menu n’est plus valable.");
  o.menu = null;
  switch (action) {
    case "retour":
    case "suivant":
    case "recharger":
      return historique(id, action);
    case "couper":
      return wc.cut();
    case "copier":
      return wc.copy();
    case "coller":
      return wc.paste();
    case "tout":
      return wc.selectAll();
    case "copier-lien":
      if (m.lien) clipboard.writeText(m.lien);
      return;
    case "lien-onglet":
      if (m.lien) ouvrirOnglet(o.chatId, m.lien);
      return;
    case "lien-ailleurs":
      if (m.lien && /^https?:/i.test(m.lien)) await shell.openExternal(m.lien);
      return;
    case "image-onglet":
      if (m.image) ouvrirOnglet(o.chatId, m.image);
      return;
    case "copier-image":
      if (m.image) clipboard.writeText(m.image);
      return;
    case "chercher":
      if (m.selection) ouvrirOnglet(o.chatId, RECHERCHE + encodeURIComponent(m.selection.slice(0, 200)));
      return;
    default:
      throw new Error("Action inconnue.");
  }
}

export function apresAction(o: Onglet): void {
  planifierVignette(o, 400);
}

/* ─── Branchement ─────────────────────────────────────────────── */

export function brancherNavigateur(options: { fenetre: () => BrowserWindow | null; signaler: (etat: OngletPublic[]) => void; menu?: (id: string, menu: ParametresMenu) => void }): void {
  fenetre = options.fenetre;
  signaler = options.signaler;
  if (options.menu) montrerMenu = options.menu;
  fichierEtat = path.join(app.getPath("userData"), "navigateur.json");
  restaurer();
  lireValeursNatives();
  app.on("browser-window-created", (_e, win) => win.webContents.once("did-finish-load", lireValeursNatives));
}

/** Pour les tests : l'onglet interne (sa page). */
export function contenuDe(id: string): WebContents | null {
  const o = onglets.get(id);
  return o ? vivante(o) : null;
}
