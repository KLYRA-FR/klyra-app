/**
 * Appel au VPS depuis le processus principal.
 * La fenêtre ne fetch pas cette origine : sa politique de connexion
 * n’autorise que l’app et le compte Convex.
 */

import {
  CHEMIN_SERVEUR,
  MESSAGE_REPONSE,
  MESSAGE_SILENCE,
  lireCorps,
  lireSaisie,
  type Lecture,
} from "./lecture-serveur.ts";

const ATTENTE_MS = 8_000;

export type DemandeHttp = (
  url: string,
  invitation: string | null,
  signal: AbortSignal,
) => Promise<{ status: number; json: unknown }>;

/** Politique de la fenêtre. Le VPS n’y est pas : l’appel passe par `appelerServeur`. */
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

/**
 * N’appelle que l’origine acceptée par `lireSaisie` : https, ou http sur la machine locale.
 * Le chemin est fixe. Une redirection n’est pas suivie.
 */
export async function appelerServeur(adresse: unknown, invitation: unknown, demander: DemandeHttp): Promise<Lecture> {
  if (typeof adresse !== "string") return { ok: false, message: MESSAGE_SILENCE };
  if (invitation !== null && invitation !== undefined && typeof invitation !== "string") {
    return { ok: false, message: MESSAGE_SILENCE };
  }
  const lu = lireSaisie(adresse, typeof invitation === "string" ? invitation : "");
  if (!lu.ok) return lu;

  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const recu = await demander(`${lu.adresse}${CHEMIN_SERVEUR}`, lu.invitation, controle.signal);
    if (recu.status >= 300 && recu.status < 400) return { ok: false, message: MESSAGE_REPONSE };
    return lireCorps(recu.status, recu.json);
  } catch {
    return { ok: false, message: MESSAGE_SILENCE };
  } finally {
    clearTimeout(delai);
  }
}
