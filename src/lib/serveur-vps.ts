/**
 * Raccordement à un VPS déjà en marche.
 * Le lien (ou le QR) affiché dans le terminal du VPS porte un code à usage unique,
 * échangé contre un jeton d’appareil. Les chemins sont ceux de `serveur/klyra-serveur.mjs`.
 * Dans la fenêtre PC, les appels partent du processus principal, qui garde le jeton chiffré.
 * Hors Electron (téléphone), ils partent d’ici et le jeton reste dans ce navigateur.
 */

import {
  CHEMIN_APPAIRER,
  CHEMIN_APPAREIL,
  CHEMIN_SERVEUR,
  MESSAGE_INVITATION,
  MESSAGE_SILENCE,
  MESSAGE_VERSION,
  lireAppairage,
  lireCorps,
  lireSaisie,
  type Lecture,
} from "../../electron/lecture-serveur";
import { VERSION_CODE_SERVEUR } from "../../electron/version-serveur";

export { VERSION_CODE_SERVEUR };
export {
  CHEMIN_SERVEUR,
  MESSAGE_CODE,
  MESSAGE_INVITATION,
  MESSAGE_REPONSE,
  MESSAGE_SILENCE,
  MESSAGE_VERSION,
  PROTOCOLE_SERVEUR,
  lireCorps,
  lireSaisie,
} from "../../electron/lecture-serveur";
export type { Lecture, Saisie } from "../../electron/lecture-serveur";

export const CLE_CARNET = "klyra:serveurs";
/** Lien `klyra://rejoindre` reçu par Electron, en attendant l’écran Serveurs. */
export const CLE_LIEN_ATTENTE = "klyra:lien-attente";
/** « Ajouter un serveur » demandé d'ailleurs (sélecteur du rail) quand l'écran Serveurs est déjà ouvert. */
export const EVENEMENT_AJOUTER = "klyra:ajouter-serveur";
/** Hors Electron seulement : les jetons d’appareil, par origine. */
const CLE_JETONS = "klyra:jetons-serveurs";

const ATTENTE_MS = 8_000;
const MAX_SERVEURS = 20;

export type EtatServeur = "joint" | "quitte";

export interface ServeurConnu {
  id: string;
  adresse: string;
  nom: string;
  version: string;
  etat: EtatServeur;
}

export interface Carnet {
  actif: string | null;
  liste: ServeurConnu[];
}

/** Ce qu'on sait d'un serveur relié, d'après sa dernière réponse. */
export type Sonde = "attente" | "repond" | "silence" | "invitation" | "version";

export function sondeDe(lecture: Lecture): Sonde {
  if (lecture.ok) return "repond";
  if (lecture.message === MESSAGE_INVITATION) return "invitation";
  if (lecture.message === MESSAGE_VERSION) return "version";
  return "silence";
}

/**
 * Le code de ce VPS est-il plus ancien que celui que cette app attend ? Le serveur ne se met pas à jour seul,
 * et l'app si. Sans version : un serveur d'avant ce contrôle, donc en retard. Plus récent que l'app :
 * c'est l'app qui n'a pas encore pris sa mise à jour, il n'y a rien à faire sur le VPS.
 */
export function serveurEnRetard(versionCode: number | undefined): boolean {
  return versionCode === undefined || versionCode < VERSION_CODE_SERVEUR;
}

/** Le retard d'après une réponse. Un serveur qui ne répond pas n'a pas d'âge connu. */
export function retardDe(lecture: Lecture): boolean {
  return lecture.ok && serveurEnRetard(lecture.versionCode);
}

const AGENTS: Record<string, string> = {
  pret: "agents prêts",
  "non-connecte": "Claude Code à connecter (connecter-claude)",
  absent: "Claude Code absent : relance la commande",
};

export function libelleServeur(etat: EtatServeur, sonde: Sonde | undefined, agents: string | undefined, retard = false): string {
  if (etat === "quitte") return "Quitté";
  const detail = sonde === "repond" ? "Répond" : sonde === "invitation" ? "Plus relié" : sonde === "version" ? "Autre version" : sonde === "silence" ? "Ne répond pas" : "Vérification…";
  if (sonde === "repond" && retard) return `${detail} · à mettre à jour`;
  return sonde === "repond" && agents && AGENTS[agents] ? `${detail} · ${AGENTS[agents]}` : detail;
}

export function carnetVide(): Carnet {
  return { actif: null, liste: [] };
}

/** Première commande de l’écran vide : ouvrir un terminal sur le VPS. L’adresse est à remplacer. */
export const COMMANDE_SSH = "ssh root@ADRESSE_DU_VPS";

/** Commande montrée sur l’écran vide : `serveur/lancer.sh`, lu sur main (dépôt public). */
export const COMMANDE_SERVEUR = "curl -fsSL https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sudo sh";

/** Le texte copié, s’il est un lien `klyra://rejoindre` lisible. Tout autre texte reste dans le presse-papiers. */
export function lienCopie(texte: unknown): string | null {
  if (typeof texte !== "string") return null;
  const brut = texte.trim();
  if (brut.length > 2048 || !brut.toLowerCase().startsWith("klyra://rejoindre")) return null;
  const lu = lireSaisie(brut);
  return lu.ok && lu.code ? brut : null;
}

function estServeur(valeur: unknown): valeur is ServeurConnu {
  if (!valeur || typeof valeur !== "object") return false;
  const serveur = valeur as Record<string, unknown>;
  return (
    typeof serveur.id === "string" &&
    typeof serveur.adresse === "string" &&
    typeof serveur.nom === "string" &&
    typeof serveur.version === "string" &&
    (serveur.etat === "joint" || serveur.etat === "quitte")
  );
}

export function lireCarnet(brut: string | null): Carnet {
  try {
    const valeur: unknown = JSON.parse(brut ?? "null");
    if (!valeur || typeof valeur !== "object") return carnetVide();
    const carnet = valeur as Record<string, unknown>;
    if (!Array.isArray(carnet.liste)) return carnetVide();
    // Une ancienne entrée garde son invitation : elle n’est plus lue.
    const liste = carnet.liste.filter(estServeur).slice(0, MAX_SERVEURS).map(({ id, adresse, nom, version, etat }) => ({ id, adresse, nom, version, etat }));
    const actif = typeof carnet.actif === "string" && liste.some((serveur) => serveur.id === carnet.actif) ? carnet.actif : null;
    return { actif, liste };
  } catch {
    return carnetVide();
  }
}

export function ajouterServeur(carnet: Carnet, entre: Omit<ServeurConnu, "id" | "etat">): Carnet {
  const id = entre.adresse;
  const suivant: ServeurConnu = { ...entre, id, etat: "joint" };
  const existe = carnet.liste.some((serveur) => serveur.id === id);
  if (!existe && carnet.liste.length >= MAX_SERVEURS) return carnet;
  const liste = existe ? carnet.liste.map((serveur) => (serveur.id === id ? suivant : serveur)) : [...carnet.liste, suivant];
  return { actif: id, liste };
}

export function retirerServeur(carnet: Carnet, id: string): Carnet {
  return {
    actif: carnet.actif === id ? null : carnet.actif,
    liste: carnet.liste.filter((serveur) => serveur.id !== id),
  };
}

export function quitterServeur(carnet: Carnet, id: string): Carnet {
  return {
    actif: carnet.actif === id ? null : carnet.actif,
    liste: carnet.liste.map((serveur) => (serveur.id === id ? { ...serveur, etat: "quitte" as const } : serveur)),
  };
}

export function choisirServeur(carnet: Carnet, id: string): Carnet {
  if (!carnet.liste.some((serveur) => serveur.id === id && serveur.etat === "joint")) return carnet;
  return { ...carnet, actif: id };
}

export function placePour(carnet: Carnet, adresse: string): boolean {
  return carnet.liste.some((serveur) => serveur.id === adresse) || carnet.liste.length < MAX_SERVEURS;
}

type ReponsePont = { ok: true; data: unknown } | { ok: false; code: string; message: string };

interface PontServeur {
  interroger?: (adresse: string) => Promise<ReponsePont>;
  appairer?: (adresse: string, code: string) => Promise<ReponsePont>;
  retirer?: (adresse: string) => Promise<ReponsePont>;
}

function estLecture(valeur: unknown): valeur is Lecture {
  if (!valeur || typeof valeur !== "object") return false;
  const lu = valeur as Record<string, unknown>;
  if (lu.ok === true) return typeof lu.nom === "string" && typeof lu.version === "string";
  if (lu.ok === false) return typeof lu.message === "string";
  return false;
}

/** Présent dans la fenêtre Electron (avec `appairer`). Absent sur le téléphone : les appels restent des fetch. */
function pont(): PontServeur | null {
  const fenetre = (globalThis as { window?: { klyra?: { serveur?: PontServeur } } }).window;
  const serveur = fenetre?.klyra?.serveur;
  return serveur && typeof serveur.appairer === "function" ? serveur : null;
}

async function parPont(appel: () => Promise<ReponsePont>, signal?: AbortSignal): Promise<Lecture> {
  if (signal?.aborted) return { ok: false, message: MESSAGE_SILENCE };
  try {
    const reponse = await appel();
    if (!reponse.ok || !estLecture(reponse.data)) return { ok: false, message: MESSAGE_SILENCE };
    return reponse.data;
  } catch {
    return { ok: false, message: MESSAGE_SILENCE };
  }
}

function lireJetons(): Record<string, string> {
  try {
    const brut: unknown = JSON.parse(localStorage.getItem(CLE_JETONS) ?? "{}");
    return brut && typeof brut === "object" ? (brut as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Le jeton de ce téléphone pour ce VPS (hors Electron), ou null s'il n'y est pas relié. */
export function jetonAppareil(adresse: string): string | null {
  const jeton = lireJetons()[adresse];
  return typeof jeton === "string" && jeton ? jeton : null;
}

function ecrireJeton(adresse: string, jeton: string | null) {
  try {
    const jetons = lireJetons();
    if (jeton) jetons[adresse] = jeton;
    else delete jetons[adresse];
    localStorage.setItem(CLE_JETONS, JSON.stringify(jetons));
  } catch {
    /* Sans stockage, il faudra relier le serveur à nouveau. */
  }
}

/** Un fetch hors Electron. Toute panne réseau, délai dépassé compris, est un serveur qui ne répond pas. */
async function appelDirect(url: string, init: RequestInit, signal?: AbortSignal): Promise<{ status: number; json: unknown } | null> {
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  const annuler = () => controle.abort();
  signal?.addEventListener("abort", annuler);
  try {
    const reponse = await fetch(url, { ...init, signal: controle.signal, cache: "no-store", redirect: "error" });
    return { status: reponse.status, json: await reponse.json().catch(() => null) };
  } catch {
    return null;
  } finally {
    clearTimeout(delai);
    signal?.removeEventListener("abort", annuler);
  }
}

/** Le serveur répond-il à cet appareil ? */
export async function interroger(adresse: string, signal?: AbortSignal): Promise<Lecture> {
  const electron = pont();
  if (electron?.interroger) return parPont(() => electron.interroger!(adresse), signal);
  const jeton = lireJetons()[adresse];
  if (!jeton) return { ok: false, message: MESSAGE_INVITATION };
  const recu = await appelDirect(`${adresse}${CHEMIN_SERVEUR}`, { headers: { Authorization: `Bearer ${jeton}` } }, signal);
  return recu ? lireCorps(recu.status, recu.json) : { ok: false, message: MESSAGE_SILENCE };
}

/** Échange le code du lien contre un jeton d’appareil, gardé là où l’app tourne. */
export async function appairer(adresse: string, code: string): Promise<Lecture> {
  const electron = pont();
  if (electron?.appairer) return parPont(() => electron.appairer!(adresse, code));
  const recu = await appelDirect(`${adresse}${CHEMIN_APPAIRER}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, appareil: "Téléphone" }),
  });
  if (!recu) return { ok: false, message: MESSAGE_SILENCE };
  const lu = lireAppairage(recu.status, recu.json);
  if (!lu.ok) return lu;
  ecrireJeton(adresse, lu.jeton);
  return { ok: true, nom: lu.nom, version: lu.version };
}

/** Le serveur oublie cet appareil s’il répond ; l’app oublie le jeton dans tous les cas. */
export async function retirer(adresse: string): Promise<void> {
  const electron = pont();
  if (electron?.retirer) {
    await electron.retirer(adresse).catch(() => null);
    return;
  }
  const jeton = lireJetons()[adresse];
  if (jeton) await appelDirect(`${adresse}${CHEMIN_APPAREIL}`, { method: "DELETE", headers: { Authorization: `Bearer ${jeton}` } });
  ecrireJeton(adresse, null);
}
