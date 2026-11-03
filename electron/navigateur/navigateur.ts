import { app, shell, session as sessions, WebContentsView, type BrowserWindow, type Session, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  adresseAutorisee,
  evenementsTouche,
  hoteDe,
  MONDE_ISOLE,
  normaliserAdresse,
  SCRIPT_INSTANTANE,
  SCRIPT_TEXTE,
  SCRIPT_VALEUR_FOCUS,
  scriptChoisir,
  scriptCible,
  scriptContient,
  scriptCurseur,
  scriptDefiler,
  scriptFocus,
  type InstantanePage,
} from "./regles";

/**
 * Le navigateur de KLYRA : de vraies pages Chromium (WebContentsView) posées
 * dans la fenêtre de l'app, à l'endroit que l'onglet « Navigateur » du panneau
 * d'une conversation leur réserve, sur le modèle d'OpenBot (`browser-host.ts`).
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
  /** Sa page est à l'écran, dans le panneau. */
  affiche: boolean;
  /** L'agent qui l'utilise en ce moment, et sa dernière action. */
  pilote: { roleId: string; action: string; at: number } | null;
  main: MainOnglet;
  telechargements: Telechargement[];
  creeLe: number;
  vuLe: number;
}

interface Onglet extends Omit<OngletPublic, "endormi" | "affiche"> {
  vue: WebContentsView | null;
  /** 1 px de la dernière capture = `echelle` px de la page. */
  echelle: number;
  /** Ce que la page a demandé (alert, confirm) pendant que l'agent pilotait, à lui dire. */
  notes: string[];
  minuteurPilote: NodeJS.Timeout | null;
  minuteurVignette: NodeJS.Timeout | null;
  derniereVignette: number;
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
const DELAI_CHARGEMENT_MS = 20_000;
const DUREE_PILOTE_MS = 12_000;
const TELECHARGEMENT_MAX = 1024 ** 3;
const OUBLI_MS = 30 * 24 * 3600_000;

const onglets = new Map<string, Onglet>();
let fenetre: () => BrowserWindow | null = () => null;
let signaler: (etat: OngletPublic[]) => void = () => undefined;
let affiche: { id: string; cadre: Electron.Rectangle } | null = null;
let fenetreSuivie: BrowserWindow | null = null;
let sessionNav: Session | null = null;
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
    endormi: !o.vue,
    affiche: !!o.vue && affiche?.id === o.id,
    pilote: o.pilote,
    main: o.main,
    telechargements: o.telechargements,
    creeLe: o.creeLe,
    vuLe: o.vuLe,
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
    vue: null,
    echelle: 1,
    notes: [],
    minuteurPilote: null,
    minuteurVignette: null,
    derniereVignette: 0,
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

/** L'identité de Chrome, sans « Electron » ni le nom de l'app : certains sites refusent un navigateur embarqué. */
export function agentUtilisateur(ua: string, nomApp: string): string {
  const echappe = nomApp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return ua.replace(new RegExp(`\\s(Electron|${echappe})\\/\\S+`, "gi"), "").replace(/\s{2,}/g, " ").trim();
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
  s.setUserAgent(agentUtilisateur(s.getUserAgent(), app.getName()), app.getPreferredSystemLanguages().join(",") || app.getLocale());
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
  reveiller(o);
  o.vuLe = Date.now();
  affiche = { id, cadre: { x: cadre.x, y: cadre.y, width: cadre.width, height: cadre.height } };
  appliquerAffichage();
  changer(true);
}

/* ─── Vignettes ───────────────────────────────────────────────── */

function planifierVignette(o: Onglet, delai: number): void {
  if (o.minuteurVignette) return;
  o.minuteurVignette = setTimeout(() => {
    o.minuteurVignette = null;
    void vignette(o);
  }, Math.max(delai, 1_200 - (Date.now() - o.derniereVignette)));
}

async function vignette(o: Onglet): Promise<void> {
  const wc = vivante(o);
  if (!wc || wc.isLoading()) return;
  try {
    const image = await wc.capturePage(undefined, { stayHidden: true });
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
  onglets.set(o.id, o);
  try {
    const wc = creerVue(o);
    void wc.loadURL(url).catch(() => undefined);
    maj(o, wc);
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
  const wc = reveiller(o);
  o.erreur = null;
  void wc.loadURL(url).catch(() => undefined);
  o.vuLe = Date.now();
  changer(true);
}

export type GesteHistorique = "retour" | "suivant" | "recharger" | "arreter";

export function historique(id: string, geste: GesteHistorique): void {
  const o = exiger(id);
  const wc = reveiller(o);
  if (geste === "retour" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (geste === "suivant" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  else if (geste === "recharger") wc.reload();
  else if (geste === "arreter") wc.stop();
}

export function fermerOnglet(id: string): void {
  const o = onglets.get(String(id));
  if (!o) return;
  if (affiche?.id === id) affiche = null;
  endormir(o);
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
  for (const o of onglets.values()) if (vivante(o)) o.vue!.webContents.reload();
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
async function script<T>(wc: WebContents, code: string): Promise<T> {
  return avecDelai(
    wc.executeJavaScriptInIsolatedWorld(MONDE_ISOLE, [{ code }]) as Promise<T>,
    DELAI_SCRIPT_MS,
    "La page ne répond pas (elle charge encore, ou attend une réponse dans une fenêtre). Réessaie dans un instant ou regarde-la avec navigateur_capture.",
  );
}

/** Le protocole de débogage, attaché à la première action (Page pour les fenêtres de la page). */
async function cdp(wc: WebContents, methode: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach("1.3");
    await wc.debugger.sendCommand("Page.enable").catch(() => undefined);
    // La page se croit au premier plan : la frappe arrive même quand l'onglet n'est pas regardé.
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
  }
  return wc.debugger.sendCommand(methode, params);
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
export function pageDeLAgent(o: Onglet, roleId: string, action: string, agir: boolean): WebContents {
  if (agir && o.main?.type === "personne") throw new Error("La personne a repris la main sur cet onglet : n’y agis plus. Demande-lui dans la conversation quand tu peux continuer.");
  if (agir && o.main?.type === "demandee") throw new Error(`Tu as passé la main à la personne (${o.main.raison}) : attends qu’elle te dise que c’est fait.`);
  const wc = reveiller(o);
  o.vuLe = Date.now();
  o.pilote = { roleId, action, at: Date.now() };
  if (o.minuteurPilote) clearTimeout(o.minuteurPilote);
  o.minuteurPilote = setTimeout(() => {
    o.pilote = null;
    o.minuteurPilote = null;
    changer();
  }, DUREE_PILOTE_MS);
  changer(true);
  return wc;
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
export async function attendreCalme(wc: WebContents, ms = DELAI_CHARGEMENT_MS): Promise<void> {
  await pause(150);
  const limite = Date.now() + ms;
  while (!wc.isDestroyed() && wc.isLoading() && Date.now() < limite) await pause(100);
  await pause(250);
}

export async function lireInstantane(wc: WebContents): Promise<InstantanePage> {
  return script<InstantanePage>(wc, SCRIPT_INSTANTANE);
}

export async function lireTexte(wc: WebContents): Promise<string> {
  return script<string>(wc, SCRIPT_TEXTE);
}

/** Attend qu'un texte apparaisse dans la page (au plus `ms`). */
export async function attendreTexte(wc: WebContents, texte: string, ms: number): Promise<boolean> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await script<boolean>(wc, scriptContient(texte)).catch(() => false)) return true;
    await pause(300);
  }
  return false;
}

async function curseur(wc: WebContents, x: number, y: number): Promise<void> {
  await script(wc, scriptCurseur(x, y)).catch(() => undefined);
}

/** Les coordonnées d'un élément (`eN`) ou d'un point de la dernière capture, en pixels de la page. */
export async function viser(o: Onglet, wc: WebContents, cible: { ref?: string; x?: number; y?: number }): Promise<{ x: number; y: number; note: string | null; protege: boolean }> {
  if (cible.ref) {
    const r = await script<{ ok: boolean; raison?: string; x: number; y: number; protege: boolean; desactive: boolean; recouvert: string | null; nom: string }>(wc, scriptCible(cible.ref));
    if (!r.ok) throw new Error(r.raison);
    const notes = [r.desactive ? "l’élément est désactivé" : "", r.recouvert ? `un autre élément le recouvre (« ${r.recouvert} »)` : ""].filter(Boolean);
    return { x: r.x, y: r.y, protege: r.protege, note: notes.length ? `Attention : ${notes.join(", ")}.` : null };
  }
  if (typeof cible.x === "number" && typeof cible.y === "number" && Number.isFinite(cible.x) && Number.isFinite(cible.y)) {
    return { x: Math.round(cible.x * o.echelle), y: Math.round(cible.y * o.echelle), protege: false, note: null };
  }
  throw new Error("Vise un élément par sa référence (ref, ex. e12, lue avec navigateur_lire) ou un point (x et y de la dernière capture).");
}

export async function cliquer(wc: WebContents, x: number, y: number, options: { double?: boolean; bouton?: "left" | "right" | "middle" } = {}): Promise<void> {
  const bouton = options.bouton ?? "left";
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  void curseur(wc, x, y);
  for (let n = 1; n <= (options.double ? 2 : 1); n++) {
    await cdp(wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: bouton, clickCount: n });
    await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: bouton, clickCount: n });
  }
}

export async function survoler(wc: WebContents, x: number, y: number): Promise<void> {
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

export async function appuyer(wc: WebContents, combinaison: string): Promise<void> {
  for (const e of evenementsTouche(combinaison)) await cdp(wc, "Input.dispatchKeyEvent", { ...e });
}

/**
 * Tape un texte dans l'élément visé (ou celui qui a le focus). Jamais dans un
 * mot de passe, un code à usage unique ou un champ de carte.
 */
export async function taper(wc: WebContents, ref: string | null, texte: string, effacer: boolean): Promise<string | null> {
  const f = await script<{ ok: boolean; raison?: string; editable: boolean; protege: boolean; avant?: string }>(wc, scriptFocus(ref, effacer));
  if (!f.ok) throw new Error(f.raison);
  if (f.protege) throw new Error("Champ protégé (mot de passe, code ou carte) : tu ne le remplis jamais. Passe la main à la personne (navigateur_agir, action passer_la_main) pour qu’elle le remplisse.");
  await cdp(wc, "Input.insertText", { text: texte });
  if (!f.editable) return "Aucun champ n’avait le focus : le texte est parti au clavier vers la page.";
  const apres = await script<string | null>(wc, SCRIPT_VALEUR_FOCUS).catch(() => null);
  if (apres !== null && texte && !apres.includes(texte.slice(0, 40)) && apres === (effacer ? "" : f.avant)) return "Le champ ne semble pas avoir reçu le texte : relis la page.";
  return null;
}

export async function choisir(wc: WebContents, ref: string, valeur: string): Promise<string> {
  const r = await script<{ ok: boolean; raison?: string; choisi?: string }>(wc, scriptChoisir(ref, valeur));
  if (!r.ok) throw new Error(r.raison);
  return r.choisi ?? valeur;
}

export async function defiler(wc: WebContents, ref: string | null, dx: number, dy: number): Promise<{ y: number; bouge: boolean; max: number }> {
  const r = await script<{ ok: boolean; raison?: string; y: number; bouge: boolean; max: number }>(wc, scriptDefiler(ref, dx, dy));
  if (!r.ok) throw new Error(r.raison);
  return r;
}

/** La partie visible de la page, en JPEG, réduite à 1 280 px de large au plus. */
export async function capturer(o: Onglet, wc: WebContents): Promise<{ base64: string; largeur: number; hauteur: number; echelle: number }> {
  await attendreCalme(wc, 5_000);
  const image = await avecDelai(wc.capturePage(undefined, { stayHidden: true }), DELAI_SCRIPT_MS, "La capture n’a pas abouti.");
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

export function apresAction(o: Onglet): void {
  planifierVignette(o, 400);
}

/* ─── Branchement ─────────────────────────────────────────────── */

export function brancherNavigateur(options: { fenetre: () => BrowserWindow | null; signaler: (etat: OngletPublic[]) => void }): void {
  fenetre = options.fenetre;
  signaler = options.signaler;
  fichierEtat = path.join(app.getPath("userData"), "navigateur.json");
  restaurer();
}

/** Pour les tests : l'onglet interne (sa page). */
export function contenuDe(id: string): WebContents | null {
  const o = onglets.get(id);
  return o ? vivante(o) : null;
}
