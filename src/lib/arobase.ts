/**
 * La complétion « @ » du composeur : la saisie en cours juste avant le curseur, et les fichiers du projet qui
 * lui correspondent (le nom qui commence par la saisie d'abord, puis qui la contient, puis le chemin, puis les
 * lettres dans l'ordre). Pur : testé seul.
 */

/** La saisie après « @ », juste avant le curseur : « @src/ap » → « src/ap » ; null hors d'une mention. */
export function arobaseEnCours(texte: string, curseur: number): { debut: number; requete: string } | null {
  const m = texte.slice(0, curseur).match(/(^|\s)@([^\s@]*)$/u);
  if (!m) return null;
  return { debut: curseur - m[2].length - 1, requete: m[2] };
}

const net = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Les lettres de `q` se suivent dans `t`, dans l'ordre. */
function dansLOrdre(t: string, q: string): boolean {
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length;
}

/** Les fichiers à proposer pour cette saisie, les meilleurs d'abord (`max` au plus). */
export function fichiersProposes(fichiers: string[], requete: string, max = 8): string[] {
  const q = net(requete.trim());
  if (!q) return fichiers.filter((f) => !f.includes("/")).slice(0, max);
  const notes: { f: string; note: number }[] = [];
  for (const f of fichiers) {
    const chemin = net(f);
    const nom = chemin.slice(chemin.lastIndexOf("/") + 1);
    const note = nom.startsWith(q) ? 0 : nom.includes(q) ? 1 : chemin.startsWith(q) ? 2 : chemin.includes(q) ? 3 : dansLOrdre(chemin, q) ? 4 : -1;
    if (note >= 0) notes.push({ f, note });
  }
  return notes
    .sort((a, b) => a.note - b.note || a.f.length - b.f.length || a.f.localeCompare(b.f))
    .slice(0, max)
    .map((n) => n.f);
}

/** Ce que le message garde d'un fichier choisi : `@chemin` (entre guillemets s'il a des espaces). */
export function mentionFichier(chemin: string): string {
  return /\s/.test(chemin) ? `@"${chemin}"` : `@${chemin}`;
}
