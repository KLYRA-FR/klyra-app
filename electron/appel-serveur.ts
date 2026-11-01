/**
 * Appels au VPS depuis le processus principal.
 * La fenêtre ne fetch pas cette origine : sa politique de connexion
 * n’autorise que l’app et le compte Convex.
 */

import {
  CHEMIN_APPAIRER,
  CHEMIN_APPAREIL,
  CHEMIN_SERVEUR,
  MESSAGE_INVITATION,
  MESSAGE_REPONSE,
  MESSAGE_SILENCE,
  lireAppairage,
  lireCorps,
  lireSaisie,
  type Appairage,
  type Lecture,
} from "./lecture-serveur.ts";

const ATTENTE_MS = 8_000;

export interface RequeteHttp {
  methode: "GET" | "POST" | "DELETE";
  jeton: string | null;
  corps?: unknown;
}

export type DemandeHttp = (url: string, requete: RequeteHttp, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;

/** Politique de la fenêtre. Le VPS n’y est pas : l’appel passe par ce module. */
export function politiqueContenu(sourcesConvex: readonly string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${sourcesConvex.join(" ")}`,
    "frame-src http://localhost:* http://127.0.0.1:*",
  ].join("; ");
}

/** Seulement une origine acceptée par `lireSaisie` (https, ou http sur la machine locale), jamais un lien entier. */
function origine(adresse: unknown): string | null {
  if (typeof adresse !== "string" || adresse.toLowerCase().startsWith("klyra:")) return null;
  const lu = lireSaisie(adresse);
  return lu.ok ? lu.adresse : null;
}

/** Le chemin est fixe. Une redirection n’est pas suivie ; toute panne est un serveur qui ne répond pas. */
async function envoyer<T>(url: string, requete: RequeteHttp, demander: DemandeHttp, lire: (statut: number, json: unknown) => T, silence: T): Promise<T> {
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const recu = await demander(url, requete, controle.signal);
    if (recu.status >= 300 && recu.status < 400) return lire(0, null);
    return lire(recu.status, recu.json);
  } catch {
    return silence;
  } finally {
    clearTimeout(delai);
  }
}

/** `GET /klyra/v1/serveur` avec le jeton de cet appareil. Sans jeton, le serveur ne connaît pas cet appareil. */
export async function appelerServeur(adresse: unknown, jeton: string | null, demander: DemandeHttp): Promise<Lecture> {
  const base = origine(adresse);
  if (!base) return { ok: false, message: MESSAGE_SILENCE };
  if (!jeton) return { ok: false, message: MESSAGE_INVITATION };
  return envoyer(`${base}${CHEMIN_SERVEUR}`, { methode: "GET", jeton }, demander, lireCorps, { ok: false, message: MESSAGE_SILENCE });
}

/** Échange le code à usage unique contre un jeton d’appareil. */
export async function appairerServeur(adresse: unknown, code: unknown, appareil: string, demander: DemandeHttp): Promise<Appairage & { adresse?: string }> {
  const base = origine(adresse);
  if (!base) return { ok: false, message: MESSAGE_SILENCE };
  if (typeof code !== "string" || !/^[A-Za-z0-9]{6,32}$/.test(code)) return { ok: false, message: MESSAGE_REPONSE };
  const lu = await envoyer(
    `${base}${CHEMIN_APPAIRER}`,
    { methode: "POST", jeton: null, corps: { code, appareil: appareil.slice(0, 80) } },
    demander,
    lireAppairage,
    { ok: false, message: MESSAGE_SILENCE } as Appairage,
  );
  return lu.ok ? { ...lu, adresse: base } : lu;
}

/** Le serveur oublie cet appareil. Faux si le serveur n’a pas confirmé (éteint, jeton déjà retiré). */
export async function retirerAppareil(adresse: unknown, jeton: string | null, demander: DemandeHttp): Promise<boolean> {
  const base = origine(adresse);
  if (!base || !jeton) return false;
  return envoyer(`${base}${CHEMIN_APPAREIL}`, { methode: "DELETE", jeton }, demander, (statut) => statut === 204, false);
}
