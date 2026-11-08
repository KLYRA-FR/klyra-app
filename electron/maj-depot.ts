/**
 * Règles pures de la recherche d'une mise à jour (`maj.ts`), testées sans Electron
 * (`electron/maj-depot.test.mts`, dans `pnpm test:maj`).
 *
 * Deux sources pour la dernière version, dans le même dépôt public :
 *  1. l'API de GitHub (`api.github.com/…/releases/latest`) ;
 *  2. en secours, la fiche que la publication pose à côté de l'app (`latest.yml`,
 *     `latest-mac.yml`), servie par github.com lui-même : quand l'API répond 5xx
 *     ou limite le réseau (403, 429), la fiche reste en général lisible.
 * La fiche donne aussi l'empreinte : l'app téléchargée est contrôlée de la même façon.
 */

/** La version décrite par une fiche `latest.yml` : son numéro, son fichier, son empreinte. */
export interface FicheVersion {
  version: string;
  fichier: string;
  empreinte: string;
}

/**
 * Lit une fiche d'electron-builder. Le fichier retenu est celui qui finit par `suffixe`
 * (l'app pour ce système), parmi `files` ou `path`, avec l'empreinte qui lui correspond.
 */
export function lireFiche(texte: string, suffixe: string): FicheVersion | null {
  const version = texte.match(/^version:\s*['"]?([0-9][0-9A-Za-z.+-]*)['"]?\s*$/m)?.[1];
  if (!version) return null;
  /* Chaque entrée de `files` (« - url: … » puis son « sha512: »), puis `path` et le `sha512` du haut. */
  const entrees: { fichier?: string; empreinte?: string }[] = [];
  let enCours: { fichier?: string; empreinte?: string } | null = null;
  const haut: { fichier?: string; empreinte?: string } = {};
  for (const ligne of texte.split(/\r?\n/)) {
    const url = ligne.match(/^\s+-\s*url:\s*(\S+)\s*$/)?.[1];
    if (url) entrees.push((enCours = { fichier: url }));
    else if (enCours && /^\s+sha512:/.test(ligne)) enCours.empreinte = ligne.split(":").slice(1).join(":").trim();
    else if (/^\S/.test(ligne)) {
      enCours = null;
      const [cle, ...reste] = ligne.split(":");
      const valeur = reste.join(":").trim();
      if (cle === "path") haut.fichier = valeur;
      if (cle === "sha512") haut.empreinte = valeur;
    }
  }
  entrees.push(haut);
  const retenue = entrees.find((e): e is { fichier: string; empreinte: string } => !!e.fichier && !!e.empreinte && e.fichier.endsWith(suffixe) && !/[/\\]/.test(e.fichier));
  return retenue ? { version, fichier: retenue.fichier, empreinte: retenue.empreinte } : null;
}

/** « 0.1.42 » > « 0.1.9 » : comparaison nombre par nombre. */
export function plusRecente(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** Un échec qui passe en général tout seul (réseau, GitHub surchargé ou limité) : on réessaie vite. */
export function passager(statut: number | null): boolean {
  return statut === null || statut === 403 || statut === 408 || statut === 429 || statut >= 500;
}

/** Les relances après un échec passager : 2, 5, 15 puis 30 minutes, avant de revenir à l'heure. */
export const RELANCES_MIN = [2, 5, 15, 30];

/** Dans combien de minutes réessayer après le n-ième échec passager d'affilée (0 : le premier). */
export function relanceApres(echecs: number): number | null {
  return RELANCES_MIN[echecs] ?? null;
}

function quand(minutes: number | null): string {
  return minutes === null ? "L’app réessaiera dans une heure." : `L’app réessaiera dans ${minutes} minutes.`;
}

/** Un message qu'on comprend, quand le dépôt des versions ne répond pas comme prévu. */
export function messageDepot(depot: string, statut: number | null, minutes: number | null): string {
  if (statut === null) return `Impossible de joindre le dépôt des versions (${depot}) : vérifie ta connexion à internet. ${quand(minutes)}`;
  if (statut === 404) return `Le dépôt des versions (${depot}) est introuvable ou n’a aucune version publiée.`;
  if (statut === 403 || statut === 429) return `GitHub limite les vérifications pour le moment (trop de demandes depuis ce réseau). ${quand(minutes)}`;
  if (statut >= 500) return `GitHub ne répond pas (erreur ${statut}). ${quand(minutes)}`;
  return `Le dépôt des versions a répondu ${statut} : la vérification n’a pas abouti.`;
}
