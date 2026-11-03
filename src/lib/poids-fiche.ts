/**
 * Le poids d'une fiche d'agent : relue à chaque appel de l'agent, elle se paie à chaque fois
 * (depuis le cache, mais à chaque fois). Estimé d'après sa longueur, comme le diagnostic du poste.
 */

/**
 * Comme le diagnostic du poste (`CARACTERES_PAR_JETON` de electron/diagnostic-poste.ts, que l'écran ne
 * peut pas importer : il lit le disque). Le test vérifie qu'ils restent égaux.
 */
export const CARACTERES_PAR_JETON = 2.75;

/** Au-delà, l'éditeur conseille de raccourcir. */
export const SEUIL_FICHE_LONGUE = 1500;

export const jetonsEstimes = (texte: string): number => Math.round(texte.length / CARACTERES_PAR_JETON);

/** L'aide sous la fiche dans l'éditeur : son format, son poids, et un conseil si elle s'allonge. */
export function aideFiche(corps: string, conseiller = true): string {
  const format = "En Markdown : un titre « # Nom — Rôle », une présentation, puis des sections « ## ». C’est la consigne complète de l’agent.";
  const n = jetonsEstimes(corps);
  if (!n) return format;
  const poids = ` Environ ${n.toLocaleString("fr-FR")} jetons, relus à chaque appel de l’agent.`;
  const conseil =
    conseiller && n > SEUIL_FICHE_LONGUE
      ? " Une fiche courte coûte moins : garde le rôle, la façon de travailler, les limites et les critères de sortie ; l’app donne déjà les règles d’équipe (agents actifs, fils, QA sur demande, accords)."
      : "";
  return format + poids + conseil;
}
