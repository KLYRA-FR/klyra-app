/**
 * Les skills côté écran : la commande `/<skill>` tapée en tête d'un message, et ce que la liste du
 * composeur propose. Même règle que `skillEnTete` d'electron/connaissances-agent.ts (le process
 * principal vérifie ensuite que la skill existe) ; `skills.test.ts` vérifie qu'elles s'accordent.
 */

/** Une commande de Claude Code que l'app traite à part : jamais prise pour une skill. */
const COMMANDES_A_PART = new Set(["compact"]);

/** Le nom de la skill demandée en tête d'un message (« /rangement range le dossier » → « rangement ») ; null sinon. */
export function skillEnTete(texte: string): string | null {
  const nom = /^\/([a-z0-9][a-z0-9:_-]{0,63})(?=\s|$)/i.exec(texte.trimStart())?.[1] ?? null;
  return nom && !COMMANDES_A_PART.has(nom.toLowerCase()) ? nom : null;
}

/** Ce que la personne tape en tête du message, avant le curseur : « /ran » → « ran » ; null hors d'une commande. */
export function commandeEnCours(texte: string, curseur: number): string | null {
  return /^\/([a-z0-9:_-]*)$/i.exec(texte.slice(0, curseur))?.[1] ?? null;
}

export interface SkillProposee {
  nom: string;
  description: string;
}

const sansAccents = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Les skills à proposer pour ce début de commande : nom qui commence par la saisie d'abord, puis qui la contient. */
export function skillsProposees(skills: SkillProposee[], saisie: string, max = 8): SkillProposee[] {
  const q = sansAccents(saisie);
  const uniques = [...new Map(skills.map((s) => [s.nom, s])).values()];
  const debut = uniques.filter((s) => sansAccents(s.nom).startsWith(q));
  const dedans = uniques.filter((s) => !debut.includes(s) && sansAccents(s.nom).includes(q));
  return [...debut, ...dedans].slice(0, max);
}
