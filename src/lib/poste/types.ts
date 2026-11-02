/**
 * Demandes du téléphone à l'ordinateur ouvert (spec mobile M-3), côté code partagé.
 * Le téléphone écrit `domaine.geste` et des arguments JSON ; l'ordinateur exécute le geste et répond.
 */

/** Ce que l'ordinateur sait faire pour le téléphone : un geste par nom (« fichiers.lire »). */
export type Geste = (args: unknown) => Promise<unknown>;
export type Gestes = Record<string, Geste>;

/** Une erreur dite au téléphone en clair (« Ce dossier n'existe plus sur ton Mac »). */
export class ErreurPoste extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Les arguments reçus sont du JSON venu du téléphone : chaque geste les vérifie. */
export function objet(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new ErreurPoste("arguments", "Demande illisible.");
  return args as Record<string, unknown>;
}

export function chaine(args: Record<string, unknown>, cle: string, max = 2000): string {
  const valeur = args[cle];
  if (typeof valeur !== "string" || valeur.length > max) throw new ErreurPoste("arguments", "Demande illisible.");
  return valeur;
}

export function chaineOuNull(args: Record<string, unknown>, cle: string, max = 2000): string | null {
  const valeur = args[cle];
  if (valeur === null || valeur === undefined) return null;
  return chaine(args, cle, max);
}

export function booleen(args: Record<string, unknown>, cle: string): boolean {
  const valeur = args[cle];
  if (typeof valeur !== "boolean") throw new ErreurPoste("arguments", "Demande illisible.");
  return valeur;
}

/** Délai d'attente du téléphone avant « Ton Mac ne répond pas » (P-10). */
export const DELAI_REPONSE_MS = 15_000;
