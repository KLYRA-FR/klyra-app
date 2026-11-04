/**
 * L'ordre des agents dans la barre des chats, choisi en les glissant (préférence `rang`
 * de agents-meta.json). Un agent sans rang garde l'ordre habituel, après ceux qui en ont un.
 */

/** Trie selon le rang ; à rang égal (ou sans rang), l'ordre reçu est gardé. */
export function trierParRang<T extends { id: string }>(liste: T[], rang: (id: string) => number | undefined): T[] {
  return liste
    .map((element, i) => ({ element, i, r: rang(element.id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.element);
}

/** L'ordre après avoir posé `deplace` avant (ou après) `cible`. Rien ne change si l'un des deux manque. */
export function deplacer(ordre: string[], deplace: string, cible: string, apres: boolean): string[] {
  if (deplace === cible || !ordre.includes(deplace) || !ordre.includes(cible)) return ordre;
  const sans = ordre.filter((id) => id !== deplace);
  const i = sans.indexOf(cible) + (apres ? 1 : 0);
  return [...sans.slice(0, i), deplace, ...sans.slice(i)];
}

/** Monter ou descendre d'une place (clavier). */
export function decaler(ordre: string[], id: string, pas: -1 | 1): string[] {
  const i = ordre.indexOf(id);
  const j = i + pas;
  if (i < 0 || j < 0 || j >= ordre.length) return ordre;
  return deplacer(ordre, id, ordre[j], pas === 1);
}
