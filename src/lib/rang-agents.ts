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

/** L'ordre avec `id` posé à la place `place` (0 = en tête). */
export function aLaPlace(ordre: string[], id: string, place: number): string[] {
  if (!ordre.includes(id)) return ordre;
  const sans = ordre.filter((x) => x !== id);
  const i = Math.max(0, Math.min(place, sans.length));
  return [...sans.slice(0, i), id, ...sans.slice(i)];
}

/**
 * Pendant un glisser, la place visée : celle dont le milieu (les places de départ du
 * groupe) est le plus proche du milieu de la ligne glissée. Elle change à mi-chemin.
 */
export function placeVisee(milieux: number[], milieu: number): number {
  let place = 0;
  milieux.forEach((m, i) => {
    if (Math.abs(m - milieu) < Math.abs(milieux[place] - milieu)) place = i;
  });
  return place;
}

/** Les lignes entre le départ et la place visée s'écartent d'un pas pour ouvrir le trou. */
export function ecart(i: number, depart: number, place: number, pas: number): number {
  if (depart < place && i > depart && i <= place) return -pas;
  if (place < depart && i >= place && i < depart) return pas;
  return 0;
}

/** Monter ou descendre d'une place (clavier). */
export function decaler(ordre: string[], id: string, pas: -1 | 1): string[] {
  const i = ordre.indexOf(id);
  const j = i + pas;
  if (i < 0 || j < 0 || j >= ordre.length) return ordre;
  return deplacer(ordre, id, ordre[j], pas === 1);
}
