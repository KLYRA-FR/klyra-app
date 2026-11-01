/**
 * Raccordement à un VPS déjà en marche.
 * Le téléphone ouvre le lien d’invitation, ou le QR affiché par le serveur.
 * Le chemin doit rester celui de `serveur/klyra-serveur.mjs`.
 */

export const PROTOCOLE_SERVEUR = 1;
export const CHEMIN_SERVEUR = "/klyra/v1/serveur";
export const CLE_CARNET = "klyra:serveurs";
/** Lien `klyra://rejoindre` reçu par Electron, en attendant l’écran Serveurs. */
export const CLE_LIEN_ATTENTE = "klyra:lien-attente";

export const MESSAGE_SILENCE = "Ce serveur ne répond pas. S’il est éteint, la connexion échoue.";
export const MESSAGE_INVITATION = "Cette invitation n’est pas la bonne.";
export const MESSAGE_VERSION = "Ce serveur ne parle pas la même version.";
export const MESSAGE_REPONSE = "Ce serveur n’a pas répondu comme un VPS KLYRA.";

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

export type Saisie =
  | { ok: true; adresse: string; invitation: string | null }
  | { ok: false; message: string };

export type Lecture =
  | { ok: true; nom: string; version: string }
  | { ok: false; message: string };

export function carnetVide(): Carnet {
  return { actif: null, liste: [] };
}

function estIpv4(hote: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hote);
}

export function lireSaisie(texte: string, invitationSaisie: string): Saisie {
  const brut = texte.trim();
  if (!brut) return { ok: false, message: "Colle le lien d’invitation." };
  if (estIpv4(brut.split("/")[0]?.split(":")[0] ?? "")) {
    return { ok: false, message: "Colle le lien d’invitation, pas une adresse IP." };
  }

  let invitationLien: string | null = null;
  let candidat = brut;
  if (brut.toLowerCase().startsWith("klyra://")) {
    let lien: URL;
    try {
      lien = new URL(brut);
    } catch {
      return { ok: false, message: "Cette invitation n’est pas lisible." };
    }
    if (lien.hostname !== "rejoindre") return { ok: false, message: "Cette invitation n’est pas lisible." };
    const adresse = lien.searchParams.get("adresse")?.trim() ?? "";
    if (!adresse) return { ok: false, message: "Cette invitation n’a pas d’adresse." };
    invitationLien = lien.searchParams.get("invitation");
    candidat = adresse;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidat)) {
    return { ok: false, message: "Colle le lien d’invitation." };
  }

  let url: URL;
  try {
    url = new URL(candidat);
  } catch {
    return { ok: false, message: "Cette adresse n’est pas lisible." };
  }
  if (estIpv4(url.hostname) && url.hostname !== "127.0.0.1" && !brut.toLowerCase().startsWith("klyra://")) {
    return { ok: false, message: "Colle le lien d’invitation, pas une adresse IP." };
  }
  if (url.username || url.password) return { ok: false, message: "L’adresse ne doit pas contenir de mot de passe." };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "L’adresse doit commencer par https://." };
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol === "http:" && !local) return { ok: false, message: "L’adresse doit commencer par https://." };
  if (!url.hostname || url.origin === "null" || url.origin.length > 200) return { ok: false, message: "Cette adresse n’est pas lisible." };

  const champ = invitationSaisie.trim();
  const invitation = champ || invitationLien?.trim() || null;
  if (invitation && (invitation.length > 200 || /[\r\n]/.test(invitation))) {
    return { ok: false, message: "Cette invitation n’est pas lisible." };
  }
  return { ok: true, adresse: url.origin, invitation };
}

/** Commande montrée sur l’écran vide : `serveur/lancer.sh`, lu sur main (dépôt public). */
export const COMMANDE_SERVEUR = "curl -fsSL https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sh";

/** Le texte copié, s’il est un lien `klyra://rejoindre` lisible. Tout autre texte reste dans le presse-papiers. */
export function lienCopie(texte: unknown): string | null {
  if (typeof texte !== "string") return null;
  const brut = texte.trim();
  if (brut.length > 2048 || !brut.toLowerCase().startsWith("klyra://rejoindre")) return null;
  return lireSaisie(brut, "").ok ? brut : null;
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

export function lireCorps(statut: number, corps: unknown): Lecture {
  if (statut === 401) return { ok: false, message: MESSAGE_INVITATION };
  if (!corps || typeof corps !== "object") return { ok: false, message: MESSAGE_REPONSE };
  const recu = corps as Record<string, unknown>;
  if (recu.produit !== "klyra-serveur") return { ok: false, message: MESSAGE_REPONSE };
  if (recu.protocole !== PROTOCOLE_SERVEUR) return { ok: false, message: MESSAGE_VERSION };
  if (typeof recu.nom !== "string" || !recu.nom.trim() || typeof recu.version !== "string" || !recu.version.trim()) {
    return { ok: false, message: MESSAGE_REPONSE };
  }
  return { ok: true, nom: recu.nom.trim().slice(0, 80), version: recu.version.trim().slice(0, 40) };
}

/** Appelle le VPS. Toute panne réseau, délai dépassé compris, est un serveur qui ne répond pas. */
export async function interroger(adresse: string, invitation: string | null, signal?: AbortSignal): Promise<Lecture> {
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
