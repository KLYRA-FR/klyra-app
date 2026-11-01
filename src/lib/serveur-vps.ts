/**
 * Raccordement à un VPS déjà en marche.
 * Le téléphone ouvre le lien d’invitation, ou le QR affiché par le serveur.
 * Le chemin doit rester celui de `serveur/klyra-serveur.mjs`.
 * Hors Electron, l’appel part d’ici. Dans la fenêtre PC, il part du processus principal.
 */

import { CHEMIN_SERVEUR, MESSAGE_SILENCE, lireCorps, type Lecture } from "../../electron/lecture-serveur";

export {
  CHEMIN_SERVEUR,
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

const ATTENTE_MS = 8_000;
const MAX_SERVEURS = 20;

export type EtatServeur = "joint" | "quitte";

export interface ServeurConnu {
  id: string;
  adresse: string;
  invitation: string | null;
  nom: string;
  version: string;
  etat: EtatServeur;
}

export interface Carnet {
  actif: string | null;
  liste: ServeurConnu[];
}

export function carnetVide(): Carnet {
  return { actif: null, liste: [] };
}

function estServeur(valeur: unknown): valeur is ServeurConnu {
  if (!valeur || typeof valeur !== "object") return false;
  const serveur = valeur as Record<string, unknown>;
  return (
    typeof serveur.id === "string" &&
    typeof serveur.adresse === "string" &&
    (serveur.invitation === null || typeof serveur.invitation === "string") &&
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
    const liste = carnet.liste.filter(estServeur).slice(0, MAX_SERVEURS);
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

function estLecture(valeur: unknown): valeur is Lecture {
  if (!valeur || typeof valeur !== "object") return false;
  const lu = valeur as Record<string, unknown>;
  if (lu.ok === true) return typeof lu.nom === "string" && typeof lu.version === "string";
  if (lu.ok === false) return typeof lu.message === "string";
  return false;
}

/** Présent dans la fenêtre Electron. Absent sur le téléphone : l’appel reste un fetch. */
function pontInterroger(): ((adresse: string, invitation: string | null) => Promise<ReponsePont>) | null {
  const fenetre = (globalThis as { window?: { klyra?: { serveur?: { interroger?: (adresse: string, invitation: string | null) => Promise<ReponsePont> } } } }).window;
  const interrogerPont = fenetre?.klyra?.serveur?.interroger;
  return typeof interrogerPont === "function" ? interrogerPont : null;
}

/** Appelle le VPS. Toute panne réseau, délai dépassé compris, est un serveur qui ne répond pas. */
export async function interroger(adresse: string, invitation: string | null, signal?: AbortSignal): Promise<Lecture> {
  const pont = pontInterroger();
  if (pont) {
    if (signal?.aborted) return { ok: false, message: MESSAGE_SILENCE };
    try {
      const reponse = await pont(adresse, invitation);
      if (!reponse.ok || !estLecture(reponse.data)) return { ok: false, message: MESSAGE_SILENCE };
      return reponse.data;
    } catch {
      return { ok: false, message: MESSAGE_SILENCE };
    }
  }

  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  const annuler = () => controle.abort();
  signal?.addEventListener("abort", annuler);
  try {
    const reponse = await fetch(`${adresse}${CHEMIN_SERVEUR}`, {
      method: "GET",
      headers: invitation ? { "X-Klyra-Invitation": invitation } : {},
      signal: controle.signal,
      cache: "no-store",
    });
    const corps: unknown = await reponse.json().catch(() => null);
    return lireCorps(reponse.status, corps);
  } catch {
    return { ok: false, message: MESSAGE_SILENCE };
  } finally {
    clearTimeout(delai);
    signal?.removeEventListener("abort", annuler);
  }
}
